"use client";

import React, { useEffect, useState } from "react";
import { Member, Profile } from "@prisma/client";
import { MemberRole } from "@/lib/db";
import { Edit, FileIcon, ShieldAlert, ShieldCheck, Trash, Check, CheckCheck, PhoneMissed, PhoneCall, MapPin, User, Lock } from "lucide-react";
// next/image removed — encrypted media is served via blob: URLs which next/image cannot handle
import * as z from "zod";
import axios from "axios";
import qs from "query-string";
import { v4 as uuidv4 } from "uuid";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useParams } from "next/navigation";
import { storeMedia } from "@/lib/device-storage";

import { UserAvatar } from "@/components/user-avatar";
import { ActionTooltip } from "@/components/action-tooltip";
import { cn } from "@/lib/utils";
import { Form, FormControl, FormField, FormItem } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useModal } from "@/hooks/use-modal-store";

interface ChatItemProps {
  id: string;
  content: string;
  member: Member & { profile: Profile };
  timestamp: string;
  fileUrl: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  thumbnailUrl?: string | null;
  mediaKey?: string | null;
  deleted: boolean;
  currentMember: Member;
  isUpdated: boolean;
  socketUrl: string;
  socketQuery: Record<string, string>;
  status?: string; // SENT, DELIVERED, READ
}

const roleIconMap: Record<string, React.ReactNode> = {
  GUEST: null,
  MODERATOR: <ShieldCheck className="h-4 w-4 ml-2 text-indigo-500" />,
  ADMIN: <ShieldAlert className="h-4 w-4 ml-2 text-rose-500" />
};

const formSchema = z.object({
  content: z.string().min(1)
});

export function ChatItem({
  id,
  content,
  member,
  timestamp,
  fileUrl,
  fileName,
  fileSize,
  mimeType,
  thumbnailUrl,
  mediaKey,
  deleted,
  currentMember,
  isUpdated,
  socketUrl,
  socketQuery,
  status = "SENT"
}: ChatItemProps) {
  const [isEditing,  setIsEditing]  = useState(false);
  // Decrypted blob URL for encrypted media — populated asynchronously
  const [mediaBlobUrl, setMediaBlobUrl] = useState<string | null>(null);
  const { onOpen } = useModal();

  const params = useParams();
  const router = useRouter();

  const isOwner = currentMember.id === member.id;
  const isAdmin = currentMember.role === MemberRole.ADMIN;
  const isModerator = currentMember.role === MemberRole.MODERATOR;
  const canDeleteMessage = !deleted && (isAdmin || isModerator || isOwner);
  const canEditMessage = !deleted && isOwner && !fileUrl;

  // Resolve file type from mimeType (preferred) or URL extension (legacy public/ files)
  const effectiveMime = mimeType || "";
  const fileType = fileUrl?.split(".").pop()?.toLowerCase();
  const isImage    = (effectiveMime.startsWith("image/")  || ["png","jpg","jpeg","gif","webp"].includes(fileType||"")) && !!fileUrl;
  const isVideo    = (effectiveMime.startsWith("video/")  || ["mp4","webm","ogg"].includes(fileType||"")) && !!fileUrl;
  const isAudio    = (effectiveMime.startsWith("audio/")  || ["mp3","wav","m4a"].includes(fileType||"")) && !!fileUrl;
  const isPDF      = (effectiveMime === "application/pdf" || fileType === "pdf") && !!fileUrl;
  const isDocument = !isImage && !isVideo && !isAudio && !!fileUrl;

  // Special message types (no fileUrl)
  const isLocation = content.startsWith("📍 Location shared");
  const isContact  = content.startsWith("👤 Contact:");

  // Decrypt & cache media in IndexedDB if this is an encrypted file
  useEffect(() => {
    if (!fileUrl || !mediaKey) return;
    let cancelled = false;
    storeMedia(fileUrl, mediaKey, effectiveMime || "application/octet-stream")
      .then(url => { if (!cancelled) setMediaBlobUrl(url); })
      .catch(() => { if (!cancelled) setMediaBlobUrl(fileUrl); }); // fallback to raw URL
    return () => { cancelled = true; };
  }, [fileUrl, mediaKey, effectiveMime]);

  // Resolved URL: decrypted blob URL if available, otherwise raw fileUrl
  const resolvedUrl = mediaKey ? (mediaBlobUrl ?? null) : fileUrl;

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { content }
  });

  const isLoading = form.formState.isSubmitting;

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      const url = qs.stringifyUrl({ url: `${socketUrl}/${id}`, query: socketQuery });
      await axios.patch(url, values);
      form.reset();
      setIsEditing(false);
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    form.reset({ content });
  }, [content, form]);

  const isCallMessage = content.includes("📞");
  const lc = content.toLowerCase();
  const isMissedCall = lc.includes("missed");
  const isDeclinedCall = lc.includes("declined");
  const isEndedCall = lc.includes("ended");
  // Extract duration from messages like "📞 Voice call ended (0:17)"
  const durationMatch = content.match(/\((\d+:\d+)\)/);
  const callDuration = durationMatch ? durationMatch[1] : null;

  let callTitle = "Call";
  if (isMissedCall) callTitle = "Missed Call";
  else if (isDeclinedCall) callTitle = "Declined";
  else if (isEndedCall) callTitle = callDuration ? `Ended · ${callDuration}` : "Call Ended";

  const onCallBack = () => {
    const isVideo = content.toLowerCase().includes("video");
    const newCallId = uuidv4();
    const queryParam = isVideo ? "video=true" : "audio=true";
    router.push(`/servers/${params?.serverId}/conversations/${member.id}?${queryParam}&start=true&callId=${newCallId}`);
  };

  // Render WhatsApp-style ticks
  const renderTicks = () => {
    if (!isOwner || deleted) return null;

    if (status === "READ") {
      return (
        <ActionTooltip label="Read">
          <CheckCheck className="h-3.5 w-3.5 text-sky-400 -ml-1" />
        </ActionTooltip>
      );
    }

    if (status === "DELIVERED") {
      return (
        <ActionTooltip label="Delivered">
          <CheckCheck className="h-3.5 w-3.5 text-zinc-400 -ml-1" />
        </ActionTooltip>
      );
    }

    return (
      <ActionTooltip label="Sent">
        <Check className="h-3.5 w-3.5 text-zinc-400 -ml-1" />
      </ActionTooltip>
    );
  };

  return (
    <div className={cn(
      "relative group flex items-start px-4 mb-4 w-full",
      isOwner ? "justify-end" : "justify-start"
    )}>
      <div className={cn(
        "flex max-w-[80%] gap-x-3",
        isOwner ? "flex-row-reverse" : "flex-row"
      )}>
        {!isOwner && (
          <div className="shrink-0 mt-1">
            <UserAvatar src={member.profile.imageUrl} className="h-10 w-10" />
          </div>
        )}

        <div className={cn(
          "flex flex-col gap-y-1",
          isOwner ? "items-end" : "items-start"
        )}>
          {!isOwner && (
            <div className="flex items-center gap-x-2 ml-1">
              <p className="font-bold text-xs text-zinc-400">
                {member.profile.name}
              </p>
              {roleIconMap[member.role]}
            </div>
          )}

          {isCallMessage ? (
            <div className={cn(
              "flex items-center gap-x-4 px-4 py-3 rounded-full border shadow-xl min-w-[280px]",
              (isMissedCall || isDeclinedCall) ? "bg-rose-500/10 border-rose-500/20" :
              isEndedCall ? "bg-emerald-500/10 border-emerald-500/20" :
              "bg-zinc-500/10 border-zinc-500/20"
            )}>
              <div className={cn(
                "h-10 w-10 rounded-full flex items-center justify-center shrink-0 shadow-lg",
                (isMissedCall || isDeclinedCall) ? "bg-rose-500 shadow-rose-500/30" :
                isEndedCall ? "bg-emerald-500 shadow-emerald-500/30" :
                "bg-zinc-600 shadow-zinc-600/30"
              )}>
                {(isMissedCall || isDeclinedCall) ? <PhoneMissed className="h-5 w-5 text-white" /> : <PhoneCall className="h-5 w-5 text-white" />}
              </div>
              <div className="flex flex-col flex-1">
                <span className={cn(
                  "font-bold text-sm",
                  (isMissedCall || isDeclinedCall) ? "text-rose-400" :
                  isEndedCall ? "text-emerald-400" :
                  "text-zinc-400"
                )}>
                  {callTitle}
                </span>
                <span className="text-[10px] font-mono text-zinc-500">{timestamp}</span>
              </div>
              {!isOwner && (isMissedCall || isDeclinedCall) && (
                <button
                  onClick={onCallBack}
                  className="px-4 py-1.5 rounded-full border border-rose-500/50 text-rose-400 text-xs font-bold hover:bg-rose-500 hover:text-white transition-all duration-300"
                >
                  Call Back
                </button>
              )}
            </div>
          ) : isLocation ? (
            /* ── Location Message ── */
            (() => {
              const latMatch  = content.match(/lat:([-\d.]+)/);
              const lngMatch  = content.match(/lng:([-\d.]+)/);
              const accMatch  = content.match(/acc:(\d+)/);
              const lat = latMatch?.[1];
              const lng = lngMatch?.[1];
              const acc = accMatch?.[1];
              const mapUrl = lat && lng
                ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}&zoom=16`
                : null;
              return (
                <div className="flex items-center gap-x-3 px-4 py-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 min-w-[240px]">
                  <div className="h-10 w-10 rounded-full bg-emerald-500 flex items-center justify-center shrink-0 shadow-lg shadow-emerald-500/30">
                    <MapPin className="h-5 w-5 text-white" />
                  </div>
                  <div className="flex flex-col flex-1">
                    <span className="font-bold text-sm text-emerald-400">Live Location</span>
                    {lat && lng && (
                      <span className="text-[10px] font-mono text-zinc-400">
                        {parseFloat(lat).toFixed(4)}°N {parseFloat(lng).toFixed(4)}°E
                        {acc ? ` ±${acc}m` : ""}
                      </span>
                    )}
                    <span className="text-[10px] font-mono text-zinc-500">{timestamp}</span>
                  </div>
                  {mapUrl && (
                    <a
                      href={mapUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 rounded-full border border-emerald-500/40 text-emerald-400 text-xs font-bold hover:bg-emerald-500 hover:text-white transition-all"
                    >
                      Open
                    </a>
                  )}
                </div>
              );
            })()
          ) : isContact ? (
            /* ── Contact Message ── */
            (() => {
              const nameMatch  = content.match(/Contact: (.+)/);
              const emailMatch = content.match(/email:(.+)/);
              const cName  = nameMatch?.[1]?.trim()  ?? "Unknown";
              const cEmail = emailMatch?.[1]?.trim() ?? "";
              return (
                <div className="flex items-center gap-x-3 px-4 py-3 rounded-2xl bg-blue-500/10 border border-blue-500/20 min-w-[220px]">
                  <div className="h-10 w-10 rounded-full bg-blue-500 flex items-center justify-center shrink-0 shadow-lg shadow-blue-500/30">
                    <User className="h-5 w-5 text-white" />
                  </div>
                  <div className="flex flex-col flex-1">
                    <span className="font-bold text-sm text-blue-400">{cName}</span>
                    {cEmail && <span className="text-[10px] font-mono text-zinc-400">{cEmail}</span>}
                    <span className="text-[10px] font-mono text-zinc-500">{timestamp}</span>
                  </div>
                </div>
              );
            })()
          ) : (
            <div className={cn(
              "relative px-4 py-3 rounded-2xl text-[14px] shadow-lg",
              isOwner
                ? "bg-[#5865f2] text-white rounded-tr-none"
                : "bg-[#2b2d31] text-[#dbdee1] rounded-tl-none",
              deleted && "opacity-50 italic text-xs bg-transparent border border-white/10"
            )}>
              {/* Media encryption badge — shown while decrypting */}
              {fileUrl && mediaKey && !mediaBlobUrl && (
                <div className="flex items-center gap-x-1.5 text-emerald-400 text-[10px] font-mono mb-2 animate-pulse">
                  <Lock className="h-3 w-3" /> Decrypting…
                </div>
              )}

              {isImage && resolvedUrl && (
                <div className="mb-2 rounded-lg overflow-hidden border border-black/20 max-w-[300px]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={resolvedUrl} alt={fileName || content} className="w-full h-auto object-cover rounded-lg" loading="lazy" />
                </div>
              )}

              {isVideo && resolvedUrl && (
                <div className="mb-2 rounded-lg overflow-hidden border border-black/20 max-w-[300px] bg-black">
                  <video src={resolvedUrl} controls className="w-full h-full rounded-lg" />
                </div>
              )}

              {isAudio && resolvedUrl && (
                <div className="mb-2 p-2 rounded-lg bg-black/10 border border-white/5 min-w-[240px]">
                  <audio src={resolvedUrl} controls className="w-full h-8" />
                </div>
              )}

              {isDocument && resolvedUrl && (
                <div className="mb-2 relative flex items-center p-3 rounded-xl bg-[#1e1f22] border border-white/5">
                  <FileIcon className="h-10 w-10 fill-indigo-200 stroke-indigo-400" />
                  <a
                    href={resolvedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 text-sm text-indigo-500 dark:text-indigo-400 hover:underline truncate max-w-[180px]"
                  >
                    {fileName || content || "Download Document"}
                  </a>
                  {fileSize && (
                    <span className="ml-auto text-[10px] text-zinc-500 shrink-0">
                      {fileSize > 1048576 ? `${(fileSize/1048576).toFixed(1)} MB` : `${Math.round(fileSize/1024)} KB`}
                    </span>
                  )}
                </div>
              )}
              
              {!isEditing ? (
                 <div className="flex flex-col gap-y-1">
                   <p className="break-words">
                     {content}
                   </p>
                   <div className={cn(
                     "flex items-center gap-x-2",
                     isOwner ? "justify-end" : "justify-start"
                   )}>
                      <span className={cn(
                        "text-[10px] font-bold opacity-50",
                        isOwner ? "text-indigo-100" : "text-zinc-500"
                      )}>
                        {timestamp}
                      </span>
                      {renderTicks()}
                   </div>
                 </div>
              ) : (
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="flex items-center gap-x-2 min-w-[200px]">
                    <Input 
                      disabled={isLoading}
                      className="h-9 bg-black/20 border-none text-sm text-white focus-visible:ring-0" 
                      {...form.register("content")} 
                    />
                    <Button size="sm" className="bg-white text-indigo-600 hover:bg-zinc-200">Save</Button>
                  </form>
                </Form>
              )}

              {canDeleteMessage && !isEditing && (
                <div className={cn(
                  "absolute hidden group-hover:flex items-center gap-x-2 -top-4 bg-[#1e1f22] border border-white/10 p-1.5 rounded-md shadow-2xl z-10",
                  isOwner ? "right-0" : "left-0"
                )}>
                  {canEditMessage && (
                    <ActionTooltip label="Edit Message">
                      <Edit onClick={() => setIsEditing(true)} className="cursor-pointer w-3 h-3 text-zinc-400 hover:text-white transition" />
                    </ActionTooltip>
                  )}
                  <Trash onClick={() => onOpen("deleteMessage", { apiUrl: `${socketUrl}/${id}`, query: socketQuery })} className="cursor-pointer w-3 h-3 text-zinc-400 hover:text-rose-500 transition" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
