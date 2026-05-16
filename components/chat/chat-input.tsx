"use client";

import React, { useEffect, useRef } from "react";
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

interface ChatInputProps {
  apiUrl: string;
  query: Record<string, any>;
  name: string;
  type: "conversation" | "channel";
}

const formSchema = z.object({
  content: z.string().min(1)
});

export function ChatInput({ apiUrl, query, name, type }: ChatInputProps) {
  const router = useRouter();
  const { socket, isConnected } = useSocket() as { socket: any; isConnected: boolean };
  const draining = useRef(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { content: "" }
  });

  const isLoading = form.formState.isSubmitting;

  // ── Offline queue drain ────────────────────────────────────────────────────
  // Drain the IndexedDB outbox whenever the socket (re)connects.
  useEffect(() => {
    if (!isConnected || draining.current) return;
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
        });
        return true;
      } catch {
        return false;
      }
    }).then(({ sent, failed }) => {
      if (sent > 0) {
        console.log(`[ChatInput] Offline queue drained: ${sent} sent, ${failed} deferred`);
        router.refresh();
      }
    }).finally(() => { draining.current = false; });
  }, [isConnected, router]);

  // ── Service Worker registration ────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});

    // Listen for DRAIN_OUTBOX message from SW background sync
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "DRAIN_OUTBOX" && isConnected) {
        draining.current = false; // allow re-drain
      }
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, [isConnected]);

  // ── Submit ─────────────────────────────────────────────────────────────────
  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      const url = qs.stringifyUrl({ url: apiUrl, query });
      form.reset();

      if (!isConnected) {
        // Server is down — queue the message for later delivery
        await enqueue({
          id:         uuidv4(),
          apiUrl,
          query,
          content:    values.content,
          queuedAt:   Date.now(),
          retryCount: 0,
        });
        // Register background sync so the browser retries when online
        if ("serviceWorker" in navigator) {
          const reg = await navigator.serviceWorker.ready;
          if ("sync" in reg) await (reg as any).sync.register("cyberdeck-outbox");
        }
        return;
      }

      await axios.post(url, { content: values.content });
      router.refresh();
    } catch (error) {
      console.error("[ChatInput] send failed:", error);
      // Fallback: queue even on unexpected send error
      await enqueue({
        id:         uuidv4(),
        apiUrl,
        query,
        content:    values.content,
        queuedAt:   Date.now(),
        retryCount: 0,
      });
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <FormField
          control={form.control}
          name="content"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <div className="relative p-4 pb-6">
                  <ChatAttachmentMenu apiUrl={apiUrl} query={query} />
                  <Input
                    placeholder={`${
                      type === "conversation" ? `Message ${name}` : `Message #${name}`
                    }${!isConnected ? " (queued — server offline)" : ""}`}
                    disabled={isLoading}
                    className="px-14 py-6 bg-zinc-200/90 dark:bg-zinc-700/75 border-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 text-zinc-600 dark:text-zinc-200"
                    {...field}
                  />
                  <div className="absolute top-7 right-8">
                    <EmojiPicker
                      onChange={(emoji: string) =>
                        field.onChange(`${field.value} ${emoji}`)
                      }
                    />
                  </div>
                </div>
              </FormControl>
            </FormItem>
          )}
        />
      </form>
    </Form>
  );
}
