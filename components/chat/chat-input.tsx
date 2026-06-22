"use client";

import React, { useEffect, useRef, useTransition } from "react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import axios from "axios";
import qs from "query-string";
import { useRouter } from "next/navigation";
import { v4 as uuidv4 } from "uuid";

import {
  FormControl,
  Form,
  FormField,
  FormItem
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { EmojiPicker } from "@/components/emoji-picker";
import { ChatAttachmentMenu } from "@/components/chat/chat-attachment-menu";
import { useSocket } from "@/components/providers/socket-provider";
import { enqueue, drainQueue, QueuedMessage } from "@/lib/offline-queue";
import { useReplyStore } from "@/hooks/use-reply-store";
import { X, Reply, Camera, Video, FileIcon, Ban } from "lucide-react";
import { usePreferences } from "@/components/providers/socket-provider";
import { getMilitarySuggestion } from "@/lib/military-dictionary";

interface ChatInputProps {
  apiUrl: string;
  query: Record<string, any>;
  name: string;
  type: "conversation" | "channel" | "broadcast";
  otherProfileId?: string;
}

const formSchema = z.object({
  content: z.string().min(1)
});

export function ChatInput({ apiUrl, query, name, type, otherProfileId }: ChatInputProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { socket, isConnected } = useSocket() as { socket: any; isConnected: boolean };
  const { blockedUsers, refreshPreferences } = usePreferences();
  const draining = useRef(false);
  const { replyingTo, setReplyingTo } = useReplyStore();
  const [isUnblocking, setIsUnblocking] = React.useState(false);

  const isBlocked = type === "conversation" && otherProfileId && blockedUsers.some(u => u.blockedId === otherProfileId);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { content: "" }
  });

  const content = form.watch("content");
  const suggestion = getMilitarySuggestion(content);

  const isLoading = form.formState.isSubmitting;

  // ── Offline queue drain ────────────────────────────────────────────────────
  // Drain through HTTP; Socket.IO is only the realtime notification channel.
  useEffect(() => {
    if (draining.current) return;
    if (typeof window === "undefined") return;

    draining.current = true;
    drainQueue(async (msg: QueuedMessage) => {
      try {
        const url = qs.stringifyUrl({ url: msg.apiUrl, query: msg.query });
        await axios.post(url, {
          content:      msg.content,
          fileUrl:      msg.fileUrl,
          fileName:     msg.fileName,
          fileSize:     msg.fileSize,
          mimeType:     msg.mimeType,
          thumbnailUrl: msg.thumbnailUrl,
          mediaKey:     msg.mediaKey,
          type:         msg.type,
          replyToId:    msg.replyToId,
        });
        return true;
      } catch {
        return false;
      }
    }).then(({ sent, failed }) => {
      if (sent > 0) {
        console.log(`[ChatInput] Offline queue drained: ${sent} sent, ${failed} deferred`);
        startTransition(() => {
          router.refresh();
        });
      }
    }).finally(() => { draining.current = false; });
  }, [router]);

  // ── Service Worker registration ────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});

    // Listen for DRAIN_OUTBOX message from SW background sync
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "DRAIN_OUTBOX") {
        draining.current = false; // allow re-drain
      }
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, []);

  // ── Submit ─────────────────────────────────────────────────────────────────
  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      const url = qs.stringifyUrl({ url: apiUrl, query });
      const content = values.content;
      const replyToId = replyingTo?.id;

      form.reset();
      setReplyingTo(null);

      axios.post(url, { content, replyToId })
        .then(() => {
          startTransition(() => {
            router.refresh();
          });
        })
        .catch(async (error: any) => {
          console.error("[ChatInput] send failed:", error);

          // If the server explicitly rejected the message (e.g. we were blocked),
          // do not queue it for offline retry, just discard it.
          if (error?.response?.status === 403) {
            return;
          }

          // Fallback: queue even on unexpected send error
          await enqueue({
            id:         uuidv4(),
            apiUrl,
            query,
            content,
            replyToId,
            queuedAt:   Date.now(),
            retryCount: 0,
          });
          if ("serviceWorker" in navigator) {
            const reg = await navigator.serviceWorker.ready;
            if ("sync" in reg) await (reg as any).sync.register("cyberdeck-outbox");
          }
        });
    } catch (error: any) {
      console.error("[ChatInput] submit error:", error);
    }
  };

  const onUnblock = async () => {
    if (!otherProfileId || isUnblocking) return;
    try {
      setIsUnblocking(true);
      await axios.delete(`/api/block-user?profileId=${otherProfileId}`);
      refreshPreferences();
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      console.error(error);
    } finally {
      setIsUnblocking(false);
    }
  };

  return (
    <div className="w-full shrink-0">
      {isBlocked ? (
        <div className="p-4 pb-6 flex justify-center">
          <button
            onClick={onUnblock}
            disabled={isUnblocking}
            className="bg-zinc-200/90 hover:bg-zinc-300/90 dark:hover:bg-zinc-600/75 dark:bg-zinc-700/75 text-zinc-500 dark:text-zinc-400 text-sm px-6 py-3 rounded-full flex items-center justify-center w-fit shadow-sm transition cursor-pointer disabled:opacity-50"
          >
            <Ban className="h-4 w-4 mr-2" />
            {isUnblocking ? "Unblocking..." : "You blocked this contact. Tap to unblock."}
          </button>
        </div>
      ) : (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <FormField
              control={form.control}
              name="content"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <div className="p-4 pb-6">
                  {replyingTo && (
                    <div className="flex items-stretch bg-zinc-200/50 dark:bg-zinc-700/50 rounded-t-lg mb-[-8px] relative z-10 overflow-hidden">
                      {/* Left colored vertical bar */}
                      <div className="w-[4px] shrink-0 bg-indigo-500" />
                      {/* Content */}
                      <div className="flex items-center gap-x-2 overflow-hidden flex-1 px-3 py-2">
                        <div className="flex flex-col text-sm truncate flex-1">
                          <span className="font-semibold text-indigo-500 text-[13px] leading-tight">{replyingTo.memberName}</span>
                          <span className="truncate flex items-center mt-0.5 text-[13px] opacity-80 text-zinc-500 dark:text-zinc-300">
                            {replyingTo.content === "📷 Photo" ? (
                              <><Camera className="h-3.5 w-3.5 mr-1"/> Photo</>
                            ) : replyingTo.content === "🎥 Video" ? (
                              <><Video className="h-3.5 w-3.5 mr-1"/> Video</>
                            ) : (
                              replyingTo.content || "Attachment"
                            )}
                          </span>
                        </div>
                        {/* Optional thumbnail */}
                        {replyingTo.fileUrl && (replyingTo.mimeType?.startsWith("image/") || replyingTo.mimeType?.startsWith("video/") || replyingTo.content === "📷 Photo" || replyingTo.content === "🎥 Video") && (
                          <div className="w-[40px] h-[40px] shrink-0 overflow-hidden rounded bg-black/20 flex items-center justify-center">
                            {replyingTo.fileUrl.endsWith('.enc') ? (
                              <Camera className="h-4 w-4 text-zinc-400" />
                            ) : (
                              <img src={replyingTo.thumbnailUrl || replyingTo.fileUrl} alt="" className="w-full h-full object-cover" />
                            )}
                          </div>
                        )}
                      </div>
                      {/* Close button */}
                      <button type="button" onClick={() => setReplyingTo(null)} className="px-3 hover:bg-black/10 dark:hover:bg-white/10 transition shrink-0 flex items-center justify-center">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                  <div className="relative w-full">
                    <ChatAttachmentMenu apiUrl={apiUrl} query={query} replyToId={replyingTo?.id} onSent={() => setReplyingTo(null)} />

                    {/* Ghost text overlay for military auto-suggestion */}
                    {suggestion && (
                      <div className="absolute inset-0 pointer-events-none flex items-center px-14 overflow-hidden whitespace-pre font-sans text-sm">
                        <span className="text-transparent">{content}</span>
                        <span className="text-zinc-500/60 dark:text-zinc-400/60">
                          {suggestion.slice(content.split(" ").pop()?.length || 0)}
                        </span>
                      </div>
                    )}

                    <Input
                      placeholder={`${
                        type === "conversation" ? `Message ${name}` : type === "broadcast" ? `Broadcast to ${name}` : `Message #${name}`
                      }${!isConnected ? " (queued — server offline)" : ""}`}
                      disabled={isLoading}
                      className="px-14 py-6 bg-zinc-200/90 dark:bg-zinc-700/75 border-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 text-zinc-600 dark:text-zinc-200 font-sans text-sm"
                      {...field}
                      onKeyDown={(e) => {
                        if (suggestion && (e.key === "Tab" || e.key === "ArrowRight")) {
                          e.preventDefault();
                          const words = content.split(" ");
                          words[words.length - 1] = suggestion;
                          form.setValue("content", words.join(" ") + " ", { shouldValidate: true });
                        }
                      }}
                    />
                    <div className="absolute top-1/2 -translate-y-1/2 right-4">
                      <EmojiPicker
                        onChange={(emoji: string) =>
                          form.setValue("content", `${field.value} ${emoji}`, { shouldValidate: true })
                        }
                      />
                    </div>
                  </div>
                </div>
              </FormControl>
            </FormItem>
          )}
        />
      </form>
    </Form>
    )}
    </div>
  );
}
