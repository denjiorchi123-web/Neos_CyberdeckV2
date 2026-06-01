"use client";

import React, { useEffect, useRef, useState } from "react";
import { Member, Profile } from "@prisma/client";
import { MemberRole } from "@/lib/db";
import {
  Edit, FileIcon, ShieldAlert, ShieldCheck, Trash, Check, CheckCheck,
  PhoneMissed, PhoneCall, MapPin, User, Lock, Play, Pause, X,
  Download, FileText, Film, Music, Volume2, Maximize, Minimize,
  Reply, Forward, Share2, Pin, PinOff, Camera, Video
} from "lucide-react";
import * as z from "zod";
import axios from "axios";
import qs from "query-string";
import { motion, useAnimation } from "framer-motion";
import { v4 as uuidv4 } from "uuid";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useParams } from "next/navigation";
import { storeMedia } from "@/lib/device-storage";
import { UserAvatar }    from "@/components/user-avatar";
import { ActionTooltip } from "@/components/action-tooltip";
import { cn }            from "@/lib/utils";
import { Form, FormControl, FormField, FormItem } from "@/components/ui/form";
import { Input }  from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useModal } from "@/hooks/use-modal-store";
import { useReplyStore } from "@/hooks/use-reply-store";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

// ── Types ─────────────────────────────────────────────────────────────────────

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
  type?: string;
  deleted: boolean;
  currentMember: Member;
  isUpdated: boolean;
  socketUrl: string;
  socketQuery: Record<string, string>;
  status?: string;
  replyTo?: any;
  isPinned?: boolean;
}

const roleIconMap: Record<string, React.ReactNode> = {
  GUEST: null,
  MODERATOR: <ShieldCheck className="h-4 w-4 ml-2 text-indigo-500" />,
  ADMIN:     <ShieldAlert className="h-4 w-4 ml-2 text-rose-500"   />,
};

const formSchema = z.object({ content: z.string().min(1) });

function fmtSize(b: number) {
  return b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;
}

function fmtTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ── Lightbox Video Player ──────────────────────────────────────────────────────

function LightboxVideoPlayer({ src }: { src: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    // Attempt autoplay immediately
    const v = videoRef.current;
    if (v) {
      v.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
    
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    if (playing) {
      v.pause();
    } else {
      v.play().catch(() => {});
    }
  };

  const handleScrub = (e: React.MouseEvent | React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!videoRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    videoRef.current.currentTime = (x / rect.width) * duration;
  };

  const toggleFullscreen = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (!document.fullscreenElement) {
        if (containerRef.current?.requestFullscreen) {
          await containerRef.current.requestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        }
      }
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <div 
      ref={containerRef}
      className={cn(
        "relative flex items-center justify-center w-full h-full group cursor-pointer bg-black",
        isFullscreen ? "max-w-none max-h-none" : "max-w-[90vw] max-h-[90vh] rounded-xl"
      )}
      onClick={togglePlay}
    >
      <video
        ref={videoRef}
        src={src}
        className={cn(
          "max-w-full max-h-full object-contain shadow-2xl bg-black transition-all",
          isFullscreen ? "rounded-none" : "rounded-xl"
        )}
        onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onEnded={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        playsInline
      />

      {/* Big Play Overlay */}
      {!playing && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-xl pointer-events-none transition-all">
          <div className="h-24 w-24 rounded-full bg-white/10 flex items-center justify-center backdrop-blur-md border border-white/20 shadow-2xl">
            <Play className="h-12 w-12 text-white fill-white ml-2" />
          </div>
        </div>
      )}

      {/* Scrubber Bottom Bar */}
      <div 
        className={cn(
          "absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/90 via-black/40 to-transparent transition-opacity duration-300 rounded-b-xl flex items-center gap-x-4",
          playing ? "opacity-0 group-hover:opacity-100" : "opacity-100"
        )}
        onClick={e => e.stopPropagation()}
      >
        <button onClick={togglePlay} className="text-white hover:text-zinc-300 transition">
          {playing ? <Pause className="h-7 w-7 fill-white" /> : <Play className="h-7 w-7 fill-white" />}
        </button>
        
        <div 
          className="flex-1 py-4 cursor-pointer relative group/scrubber flex items-center"
          onPointerDown={(e) => {
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            handleScrub(e);
          }}
          onPointerMove={(e) => {
            e.stopPropagation();
            if (e.buttons === 1) handleScrub(e);
          }}
        >
          <div className="w-full h-2.5 bg-white/20 rounded-full relative hover:h-3 transition-all">
            <div 
              className="absolute top-0 left-0 bottom-0 bg-indigo-500 rounded-full"
              style={{ width: `${duration > 0 ? (progress / duration) * 100 : 0}%` }}
            />
            <div 
              className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg opacity-0 group-hover/scrubber:opacity-100 transition-opacity"
              style={{ left: `calc(${duration > 0 ? (progress / duration) * 100 : 0}% - 8px)` }}
            />
          </div>
        </div>

        <span className="text-white text-sm font-mono font-medium drop-shadow-md">
          {fmtTime(progress)} / {fmtTime(duration)}
        </span>

        <button onClick={toggleFullscreen} className="text-white hover:text-zinc-300 transition ml-2">
          {isFullscreen ? <Minimize className="h-6 w-6" /> : <Maximize className="h-6 w-6" />}
        </button>
      </div>
    </div>
  );
}

// ── Image Lightbox ────────────────────────────────────────────────────────────

function MediaLightbox({ src, alt, type = "image", onClose }: { src: string; alt: string; type?: "image" | "video"; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition z-[1000]"
      >
        <X className="h-6 w-6" />
      </button>
      <button
        onClick={async (e) => {
          e.stopPropagation();
          try {
            const res = await fetch(src);
            const blob = await res.blob();
            const blobUrl = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.style.display = "none";
            a.href = blobUrl;
            a.download = alt || "image";
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
              window.URL.revokeObjectURL(blobUrl);
              document.body.removeChild(a);
            }, 1000);
          } catch (error) {
            console.error("Download failed:", error);
          }
        }}
        className="absolute top-4 right-16 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition z-[1000]"
        title="Download"
      >
        <Download className="h-6 w-6" />
      </button>
      {type === "image" ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={src}
          alt={alt}
          className="max-w-[90vw] max-h-[90vh] rounded-xl object-contain shadow-2xl"
          onClick={e => e.stopPropagation()}
        />
      ) : (
        <LightboxVideoPlayer src={src} />
      )}
    </div>
  );
}

// ── Custom Audio Player ───────────────────────────────────────────────────────

const BAR_COUNT = 28;
const BARS = Array.from({ length: BAR_COUNT }, (_, i) => {
  // deterministic pseudo-random heights so bars don't change on re-render
  const h = 20 + ((i * 13 + 7) % 10) * 6;
  return h;
});

function AudioPlayer({ src, fileName }: { src: string; fileName?: string | null }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing,  setPlaying]  = useState(false);
  const [current,  setCurrent]  = useState(0);
  const [duration, setDuration] = useState(0);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else         { a.play().catch(() => {}); setPlaying(true); }
  };

  const pct = duration > 0 ? current / duration : 0;
  const activeBars = Math.round(pct * BAR_COUNT);

  return (
    <div className="flex items-center gap-x-3 py-2 px-1 min-w-[220px]">
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={e => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={e => setDuration(e.currentTarget.duration)}
        onEnded={() => { setPlaying(false); setCurrent(0); }}
      />

      {/* Play/Pause */}
      <button
        onClick={toggle}
        className="h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center shrink-0 transition"
      >
        {playing
          ? <Pause  className="h-4 w-4 text-white fill-white" />
          : <Play   className="h-4 w-4 text-white fill-white ml-0.5" />}
      </button>

      <div className="flex flex-col gap-y-1 flex-1">
        {/* Waveform bars */}
        <div
          className="flex items-end gap-[2px] h-7 cursor-pointer"
          onClick={e => {
            if (!audioRef.current || !duration) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            audioRef.current.currentTime = (x / rect.width) * duration;
          }}
        >
          {BARS.map((h, i) => (
            <div
              key={i}
              className={cn(
                "flex-1 rounded-full transition-all duration-100",
                i < activeBars
                  ? "bg-white opacity-90"
                  : "bg-white opacity-30"
              )}
              style={{ height: `${h}%` }}
            />
          ))}
        </div>

        {/* Time */}
        <div className="flex justify-between text-[10px] text-white/50 font-mono">
          <span>{fmtTime(current)}</span>
          <span>{duration > 0 ? fmtTime(duration) : "--:--"}</span>
        </div>
      </div>

      <Volume2 className="h-3.5 w-3.5 text-white/30 shrink-0" />
    </div>
  );
}

// ── Video Player ──────────────────────────────────────────────────────────────

function VideoPlayer({ src, thumbnail, onClick }: { src: string; thumbnail?: string | null; onClick: () => void }) {
  return (
    <div 
      className="relative rounded-xl overflow-hidden bg-black max-w-[300px] border border-black/30 cursor-pointer group"
      onClick={onClick}
    >
      <video
        src={src}
        poster={thumbnail ?? undefined}
        className="w-full"
      />
      <div className="absolute inset-0 flex items-center justify-center bg-black/40 group-hover:bg-black/50 transition">
        <div className="h-14 w-14 rounded-full bg-white/20 group-hover:bg-white/30 flex items-center justify-center backdrop-blur-sm border border-white/30 transition">
          <Play className="h-7 w-7 text-white fill-white ml-1" />
        </div>
      </div>
    </div>
  );
}

// ── Document Cell ─────────────────────────────────────────────────────────────

function DocCell({ url, fileName, fileSize, mimeType }: {
  url: string; fileName?: string | null; fileSize?: number | null; mimeType?: string | null;
}) {
  const ext = fileName?.split(".").pop()?.toUpperCase() ?? "FILE";
  const color =
    mimeType?.includes("pdf")  ? "bg-rose-500"   :
    mimeType?.includes("word") ? "bg-blue-500"   :
    mimeType?.includes("sheet")? "bg-emerald-600" :
    mimeType?.includes("zip")  ? "bg-yellow-600"  :
    "bg-indigo-500";

  const handleDownload = async (e: React.MouseEvent) => {
    e.preventDefault();
    try {
      // Fetching and converting to blob bypasses the Android/Windows "No Internet" download manager bug
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = blobUrl;
      a.download = fileName || "document";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        window.URL.revokeObjectURL(blobUrl);
        document.body.removeChild(a);
      }, 1000);
    } catch (error) {
      console.error("Download failed, falling back to direct open:", error);
      window.open(url, "_blank");
    }
  };

  return (
    <a
      href={url}
      onClick={handleDownload}
      className="flex items-center gap-x-3 px-3 py-2.5 rounded-xl bg-black/20 border border-white/5 hover:bg-black/30 transition max-w-[280px] cursor-pointer"
    >
      <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center shrink-0 text-white text-[9px] font-black", color)}>
        {ext.slice(0, 4)}
      </div>
      <div className="flex flex-col min-w-0">
        <span className="text-sm text-white font-medium truncate">{fileName ?? "Download"}</span>
        {fileSize && (
          <span className="text-[10px] text-white/40 font-mono">{fmtSize(fileSize)}</span>
        )}
      </div>
      <Download className="h-4 w-4 text-white/40 shrink-0 ml-auto" />
    </a>
  );
}

// ── Main ChatItem ─────────────────────────────────────────────────────────────

function ChatItemInner({
  id, content, member, timestamp, fileUrl, fileName, fileSize,
  mimeType, thumbnailUrl, mediaKey, type, deleted, currentMember,
  isUpdated, socketUrl, socketQuery, status = "SENT",
  replyTo, isPinned,
}: ChatItemProps) {
  const [isEditing,    setIsEditing]    = useState(false);
  const [mediaBlobUrl, setMediaBlobUrl] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxType, setLightboxType] = useState<"image" | "video">("image");
  const [imgError,     setImgError]     = useState(false);
  const { onOpen }  = useModal();
  const params      = useParams();
  const router      = useRouter();
  const { setReplyingTo } = useReplyStore();

  const isOwner     = currentMember.id === member.id;
  const isAdmin     = currentMember.role === MemberRole.ADMIN;
  const isModerator = currentMember.role === MemberRole.MODERATOR;
  const canDelete   = !deleted && (isAdmin || isModerator || isOwner);
  const canEdit     = !deleted && isOwner && !fileUrl;

  const controls = useAnimation();
  const onDragEnd = (event: any, info: any) => {
    // If dragged right more than 40px or flicked right with velocity
    if (info.offset.x > 40 || info.velocity.x > 300) {
      setReplyingTo({ id, content: content || fileName || "Attachment", memberName: member.profile.name, fileUrl, fileName, mimeType, type, thumbnailUrl });
    }
    controls.start({ x: 0, transition: { type: "spring", stiffness: 400, damping: 25 } });
  };

  const effectiveMime = mimeType || "";
  const fileExt       = fileUrl?.split(".").pop()?.toLowerCase() ?? "";
  const isImage    = (effectiveMime.startsWith("image/")  || ["png","jpg","jpeg","gif","webp"].includes(fileExt)) && !!fileUrl;
  const isVideo    = (effectiveMime.startsWith("video/")  || ["mp4","webm","ogg","mov"].includes(fileExt)) && !!fileUrl;
  const isAudio    = (effectiveMime.startsWith("audio/")  || ["mp3","wav","m4a","ogg","opus"].includes(fileExt)) && !!fileUrl;
  const isDocument = !isImage && !isVideo && !isAudio && !!fileUrl;

  const isCallMessage  = content.includes("📞");
  const isLocation     = content.startsWith("📍 Location shared");
  const isContact      = content.startsWith("👤 Contact:");
  const lc             = content.toLowerCase();
  const isMissedCall   = lc.includes("missed");
  const isDeclinedCall = lc.includes("declined");
  const isEndedCall    = lc.includes("ended");
  const durationMatch  = content.match(/\((\d+:\d+)\)/);
  const callDuration   = durationMatch?.[1] ?? null;
  let callTitle = "Call";
  if (isMissedCall)   callTitle = "Missed Call";
  else if (isDeclinedCall) callTitle = "Declined";
  else if (isEndedCall)    callTitle = callDuration ? `Ended · ${callDuration}` : "Call Ended";

  // Decrypt media if needed
  useEffect(() => {
    if (!fileUrl || !mediaKey) return;
    let cancelled = false;
    storeMedia(fileUrl, mediaKey, effectiveMime || "application/octet-stream")
      .then(url => { if (!cancelled) setMediaBlobUrl(url); })
      .catch(() => { if (!cancelled) setMediaBlobUrl(fileUrl); });
    return () => { cancelled = true; };
  }, [fileUrl, mediaKey, effectiveMime]);

  const resolvedUrl = mediaKey ? (mediaBlobUrl ?? null) : fileUrl;
  const isDecrypting = !!fileUrl && !!mediaKey && !mediaBlobUrl;

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { content },
  });
  const isLoading = form.formState.isSubmitting;

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      const url = qs.stringifyUrl({ url: `${socketUrl}/${id}`, query: socketQuery });
      await axios.patch(url, values);
      form.reset();
      setIsEditing(false);
    } catch (e) { console.error(e); }
  };

  useEffect(() => { form.reset({ content }); }, [content, form]);

  const onCallBack = () => {
    const vid = content.toLowerCase().includes("video");
    const newId = uuidv4();
    const q = vid ? "video=true" : "audio=true";
    router.push(`/servers/${params?.serverId}/conversations/${member.id}?${q}&start=true&callId=${newId}`);
  };

  const onPin = async () => {
    try {
      const url = qs.stringifyUrl({
        url: `${socketUrl}/${id}`,
        query: socketQuery
      });
      await axios.patch(url, { isPinned: !isPinned });
    } catch (error) {
      console.error(error);
    }
  };

  const onShare = async () => {
    const textToShare = content || fileName || "Attachment";
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Share Message",
          text: textToShare,
          url: resolvedUrl || undefined
        });
      } catch (err) {
        console.error(err);
      }
    } else {
      navigator.clipboard.writeText(textToShare);
      alert("Message copied to clipboard!");
    }
  };

  const renderTicks = () => {
    if (!isOwner || deleted) return null;
    if (status === "READ")      return <ActionTooltip label="Read"><CheckCheck className="h-3.5 w-3.5 text-sky-200 -ml-1" /></ActionTooltip>;
    if (status === "DELIVERED") return <ActionTooltip label="Delivered"><CheckCheck className="h-3.5 w-3.5 text-indigo-200 -ml-1" /></ActionTooltip>;
    return <ActionTooltip label="Sent"><Check className="h-3.5 w-3.5 text-indigo-200 -ml-1" /></ActionTooltip>;
  };

  const hasOnlyMedia = !!fileUrl && (!content || content === fileName || content === fileUrl);

  return (
    <>
      {lightboxOpen && resolvedUrl && (
        <MediaLightbox src={resolvedUrl} alt={fileName ?? content} type={lightboxType} onClose={() => setLightboxOpen(false)} />
      )}

      <ContextMenu>
        <ContextMenuTrigger asChild>
          <motion.div 
            id={`message-${id}`} 
            drag="x"
            dragConstraints={{ left: 0, right: 80 }}
            dragElastic={0.2}
            dragDirectionLock
            onDragEnd={onDragEnd}
            animate={controls}
            className={cn("relative group flex items-start px-4 mb-4 w-full cursor-pointer touch-pan-y", isOwner ? "justify-end" : "justify-start")}
          >
            <div className={cn("flex max-w-[80%] gap-x-3", isOwner ? "flex-row-reverse" : "flex-row")}>
          {!isOwner && (
            <div className="shrink-0 mt-1">
              <UserAvatar src={member.profile.imageUrl} className="h-10 w-10" />
            </div>
          )}

          <div className={cn("flex flex-col gap-y-1", isOwner ? "items-end" : "items-start")}>
            {!isOwner && (
              <div className="flex items-center gap-x-2 ml-1">
                <p className="font-bold text-xs text-zinc-400">{member.profile.name}</p>
                {roleIconMap[member.role]}
              </div>
            )}

            {/* ── Call bubble ── */}
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
                  <span className={cn("font-bold text-sm",
                    (isMissedCall || isDeclinedCall) ? "text-rose-400" :
                    isEndedCall ? "text-emerald-400" : "text-zinc-400"
                  )}>{callTitle}</span>
                  <span className="text-[10px] font-mono text-zinc-500">{timestamp}</span>
                </div>
                {!isOwner && (isMissedCall || isDeclinedCall) && (
                  <button onClick={onCallBack}
                    className="px-4 py-1.5 rounded-full border border-rose-500/50 text-rose-400 text-xs font-bold hover:bg-rose-500 hover:text-white transition-all duration-300">
                    Call Back
                  </button>
                )}
              </div>

            ) : isLocation ? (
              /* ── Location bubble ── */
              (() => {
                const lat = content.match(/lat:([-\d.]+)/)?.[1];
                const lng = content.match(/lng:([-\d.]+)/)?.[1];
                const acc = content.match(/acc:(\d+)/)?.[1];
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
                  </div>
                );
              })()

            ) : isContact ? (
              /* ── Contact bubble ── */
              (() => {
                const cName  = content.match(/Contact: (.+)/)?.[1]?.trim() ?? "Unknown";
                const cEmail = content.match(/email:(.+)/)?.[1]?.trim() ?? "";
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
              /* ── Standard message bubble ── */
              <div className="flex flex-col">
                <div className={cn(
                  "relative rounded-2xl shadow-lg overflow-hidden w-fit",
                  isOwner ? "bg-indigo-500 text-white rounded-tr-none ml-auto" : "bg-zinc-200 dark:bg-zinc-700/75 text-zinc-900 dark:text-zinc-100 rounded-tl-none mr-auto",
                  deleted && "opacity-50 italic text-xs bg-transparent border border-zinc-500/20 dark:border-white/10",
                  // Image-only messages: no padding, let image fill bubble
                  isImage && hasOnlyMedia && !replyTo ? "p-0" : "px-4 py-3",
                  isAudio && "px-3 py-2",
                )}>
                  {replyTo && !deleted && (
                    <div 
                      onClick={() => {
                        const el = document.getElementById(`message-${replyTo.id}`);
                        if (el) {
                          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          el.classList.add('bg-zinc-500/20', 'transition-all', 'duration-500');
                          setTimeout(() => el.classList.remove('bg-zinc-500/20'), 2000);
                        }
                      }}
                      className="mb-1.5 cursor-pointer active:opacity-80 transition-opacity"
                    >
                      {/* Outer rounded container with overflow-hidden so the bar clips to border-radius */}
                      <div className={cn(
                        "flex items-stretch rounded-lg overflow-hidden min-w-[180px]",
                        isOwner ? "bg-indigo-700/30" : "bg-zinc-600/40"
                      )}>
                        {/* Left colored vertical bar - flush with the rounded left edge */}
                        <div className={cn(
                          "w-[4px] shrink-0",
                          isOwner ? "bg-indigo-300" : "bg-emerald-400"
                        )} />
                        {/* Text content */}
                        <div className="flex flex-col flex-1 overflow-hidden px-2.5 py-1.5">
                          <span className={cn(
                            "text-[13px] font-semibold leading-tight",
                            isOwner ? "text-indigo-200" : "text-emerald-400"
                          )}>
                            {replyTo.member?.profile?.name || "Someone"}
                          </span>
                          <span className="text-[13px] leading-snug opacity-80 line-clamp-2 mt-0.5">
                            {replyTo.fileUrl && !replyTo.content ? (
                              <span className="flex items-center gap-1">
                                {(replyTo.mimeType?.startsWith("image/") || replyTo.content === "📷 Photo") ? (
                                  <><Camera className="h-3.5 w-3.5 inline" /> Photo</>
                                ) : (replyTo.mimeType?.startsWith("video/") || replyTo.content === "🎥 Video") ? (
                                  <><Video className="h-3.5 w-3.5 inline" /> Video</>
                                ) : (
                                  <><FileIcon className="h-3.5 w-3.5 inline" /> {replyTo.fileName || "File"}</>
                                )}
                              </span>
                            ) : replyTo.content === "📷 Photo" ? (
                              <span className="flex items-center gap-1"><Camera className="h-3.5 w-3.5" /> Photo</span>
                            ) : replyTo.content === "🎥 Video" ? (
                              <span className="flex items-center gap-1"><Video className="h-3.5 w-3.5" /> Video</span>
                            ) : (
                              replyTo.content || "Attachment"
                            )}
                          </span>
                        </div>
                        {/* Optional thumbnail on the right */}
                        {replyTo.fileUrl && (replyTo.mimeType?.startsWith("image/") || replyTo.mimeType?.startsWith("video/") || replyTo.content === "📷 Photo" || replyTo.content === "🎥 Video") && (
                          <div className="w-[46px] shrink-0 bg-black/30 flex items-center justify-center">
                            {replyTo.fileUrl.endsWith('.enc') ? (
                              <Camera className="h-5 w-5 text-zinc-400" />
                            ) : (
                              <img src={replyTo.thumbnailUrl || replyTo.fileUrl} alt="" className="w-full h-full object-cover" />
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                {/* Decrypting indicator */}
                {isDecrypting && (
                  <div className="flex items-center gap-x-1.5 text-emerald-400 text-[10px] font-mono px-4 pt-3 pb-1 animate-pulse">
                    <Lock className="h-3 w-3" /> Decrypting…
                  </div>
                )}

                {/* ── Image ── */}
                {isImage && resolvedUrl && !imgError && (
                  <div className={cn("relative group/img", hasOnlyMedia ? "" : "mb-2")}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={resolvedUrl}
                      alt={fileName ?? content}
                      className={cn(
                        "object-cover cursor-zoom-in select-none",
                        hasOnlyMedia
                          ? "w-full max-w-[300px] rounded-2xl block"
                          : "w-full max-w-[280px] rounded-lg"
                      )}
                      loading="lazy"
                      onClick={() => { setLightboxType("image"); setLightboxOpen(true); }}
                      onError={() => setImgError(true)}
                    />
                    {/* Download overlay on hover */}
                    <a
                      href={resolvedUrl}
                      download={fileName ?? true}
                      onClick={e => e.stopPropagation()}
                      className="absolute bottom-2 right-2 p-1.5 rounded-full bg-black/50 text-white opacity-0 group-hover/img:opacity-100 transition hover:bg-black/70"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </a>
                    {isDecrypting && (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center rounded-2xl">
                        <Lock className="h-6 w-6 text-emerald-400 animate-pulse" />
                      </div>
                    )}
                  </div>
                )}
                
                {isImage && resolvedUrl && imgError && (
                  <div className={cn("flex flex-col items-center justify-center p-4 bg-black/20 rounded-xl border border-white/5", hasOnlyMedia ? "w-full max-w-[300px]" : "w-full max-w-[280px] mb-2")}>
                    <FileIcon className="h-8 w-8 text-zinc-600 mb-2" />
                    <span className="text-xs text-zinc-500 font-medium">Image unavailable</span>
                  </div>
                )}

                {/* ── Video ── */}
                {isVideo && resolvedUrl && (
                  <div className={cn(hasOnlyMedia ? "" : "mb-2")}>
                    <VideoPlayer src={resolvedUrl} thumbnail={thumbnailUrl} onClick={() => { setLightboxType("video"); setLightboxOpen(true); }} />
                  </div>
                )}

                {/* ── Audio / Voice Message ── */}
                {isAudio && resolvedUrl && (
                  <AudioPlayer src={resolvedUrl} fileName={fileName} />
                )}

                {/* ── Document ── */}
                {isDocument && resolvedUrl && (
                  <div className={cn(hasOnlyMedia ? "" : "mb-2")}>
                    <DocCell url={resolvedUrl} fileName={fileName} fileSize={fileSize} mimeType={effectiveMime} />
                  </div>
                )}

                {/* ── Text content (hidden if message is pure media with no caption) ── */}
                {!isAudio && (
                  !isEditing ? (
                    <div className={cn(
                      "flex flex-col gap-y-1",
                      isImage && hasOnlyMedia ? "px-3 pb-2 pt-1" : "",
                    )}>
                      {(!hasOnlyMedia || (!isImage && !isVideo && !isDocument)) && (
                        <p className={cn("break-words", deleted && "opacity-60 italic text-xs")}>
                          {content}
                        </p>
                      )}
                      <div className={cn("flex items-center gap-x-1.5", isOwner ? "justify-end" : "justify-start")}>
                        {isPinned && (
                          <Pin className="h-3 w-3 text-amber-400 opacity-80" />
                        )}
                        {isUpdated && !deleted && (
                          <span className="text-[9px] opacity-60 italic">edited</span>
                        )}
                        <span className={cn("text-[10px] font-bold mt-0.5", isOwner ? "text-indigo-100" : "text-zinc-500 dark:text-zinc-400")}>
                          {timestamp}
                        </span>
                        {renderTicks()}
                      </div>
                    </div>
                  ) : (
                    <Form {...form}>
                      <form onSubmit={form.handleSubmit(onSubmit)} className="flex items-center gap-x-2 min-w-[200px]">
                        <Input disabled={isLoading}
                          className="h-9 bg-black/20 border-none text-sm text-white focus-visible:ring-0"
                          {...form.register("content")} />
                        <Button size="sm" className="bg-white text-indigo-600 hover:bg-zinc-200">Save</Button>
                      </form>
                    </Form>
                  )
                )}

                {/* For audio: show time+ticks below waveform */}
                {isAudio && (
                  <div className={cn("flex items-center gap-x-1.5 px-1 pb-1", isOwner ? "justify-end" : "justify-start")}>
                    {isPinned && (
                      <Pin className="h-3 w-3 text-amber-500 dark:text-amber-400 opacity-80" />
                    )}
                    <span className={cn("text-[10px] font-bold mt-0.5", isOwner ? "text-indigo-100" : "text-zinc-500 dark:text-zinc-400")}>
                      {timestamp}
                    </span>
                    {renderTicks()}
                  </div>
                )}

                {/* Hover actions removed - moved inline for touch compatibility */}
              </div>
              </div>
            )}
          </div>

          {/* Quick Forward Button for Media */}
          {fileUrl && !deleted && !isEditing && (
            <div className="flex items-center opacity-0 group-hover:opacity-100 transition duration-200 shrink-0">
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen("forwardMessage", { message: { id, content, fileUrl, fileName, mimeType, mediaKey, type, fileSize, thumbnailUrl }});
                }}
                className="p-2 rounded-full bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-zinc-500 dark:text-zinc-400 shadow-sm transition-all"
                title="Forward Media"
              >
                <Forward className="h-4 w-4" />
              </button>
            </div>
          )}

        </div>
      </motion.div>
      </ContextMenuTrigger>
      
      <ContextMenuContent className="w-48 bg-black/90 border-white/10 text-zinc-300">
        <ContextMenuItem className="hover:bg-white/10 cursor-pointer" onClick={() => setReplyingTo({ id, content: content || fileName || "Attachment", memberName: member.profile.name, fileUrl, fileName, mimeType, type, thumbnailUrl })}>
          <Reply className="mr-2 h-4 w-4" /> Reply
        </ContextMenuItem>
        <ContextMenuItem className="hover:bg-white/10 cursor-pointer" onClick={() => onOpen("forwardMessage", { message: { id, content, fileUrl, fileName, mimeType, mediaKey, type, fileSize, thumbnailUrl } })}>
          <Forward className="mr-2 h-4 w-4" /> Forward
        </ContextMenuItem>
        <ContextMenuItem className="hover:bg-white/10 cursor-pointer" onClick={onShare}>
          <Share2 className="mr-2 h-4 w-4" /> Share
        </ContextMenuItem>
        <ContextMenuSeparator className="bg-white/10" />
        <ContextMenuItem className="hover:bg-white/10 cursor-pointer" onClick={onPin}>
          {isPinned ? <PinOff className="mr-2 h-4 w-4" /> : <Pin className="mr-2 h-4 w-4" />}
          {isPinned ? "Unpin" : "Pin"}
        </ContextMenuItem>
        {(canDelete || canEdit) && (
          <>
            <ContextMenuSeparator className="bg-white/10" />
            {canEdit && (
              <ContextMenuItem className="hover:bg-white/10 cursor-pointer" onClick={() => setIsEditing(true)}>
                <Edit className="mr-2 h-4 w-4" /> Edit
              </ContextMenuItem>
            )}
            {canDelete && (
              <ContextMenuItem className="hover:bg-rose-500 hover:text-white cursor-pointer text-rose-500" onClick={() => onOpen("deleteMessage", { apiUrl: `${socketUrl}/${id}`, query: socketQuery })}>
                <Trash className="mr-2 h-4 w-4" /> Delete
              </ContextMenuItem>
            )}
          </>
        )}
      </ContextMenuContent>
      </ContextMenu>
    </>
  );
}

export const ChatItem = React.memo(ChatItemInner, (prev, next) =>
  prev.id          === next.id          &&
  prev.content     === next.content     &&
  prev.status      === next.status      &&
  prev.deleted     === next.deleted     &&
  prev.isUpdated   === next.isUpdated   &&
  prev.fileUrl     === next.fileUrl     &&
  prev.mediaKey    === next.mediaKey    &&
  prev.isPinned    === next.isPinned
);
