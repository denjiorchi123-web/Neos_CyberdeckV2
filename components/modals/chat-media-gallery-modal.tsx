"use client";

import React, { useEffect, useState } from "react";
import axios from "axios";
import { format } from "date-fns";
import { ArrowLeft, FileIcon, LinkIcon, Download, Loader2, X, Headphones, Play } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useModal } from "@/hooks/use-modal-store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { storeMedia } from "@/lib/device-storage";
import Image from "next/image";

// Reusable thumbnail for media gallery
type GalleryPreview =
  | { kind: "media"; url: string; name: string; mediaType: "image" | "video" | "audio" }
  | { kind: "doc"; url: string; name: string }
  | { kind: "link"; url: string; name: string };

function GalleryMediaItem({ message, onPreview }: { message: any; onPreview: (preview: GalleryPreview) => void }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (message.mediaKey) {
      storeMedia(message.fileUrl, message.mediaKey, message.type === "video" ? "video/mp4" : "image/jpeg")
        .then(decryptedUrl => { if (!cancelled) setUrl(decryptedUrl); })
        .catch(() => { if (!cancelled) setUrl(message.fileUrl); });
    } else {
      setUrl(message.fileUrl);
    }
    return () => { cancelled = true; };
  }, [message.fileUrl, message.mediaKey, message.type]);

  if (!url) return <div className="h-24 w-24 bg-zinc-200 dark:bg-zinc-800 animate-pulse rounded-md" />;

  if (message.type === "video") {
    return (
      <div 
        onClick={() => onPreview({ kind: "media", url, name: message.fileName || "Video", mediaType: "video" })}
        className="relative h-24 w-24 rounded-md overflow-hidden bg-black group cursor-pointer"
        style={{ touchAction: "manipulation" }}
      >
        <video src={url} className="h-full w-full object-cover opacity-80 group-hover:opacity-100 transition" />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
           <div className="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center">
             <div className="w-0 h-0 border-t-4 border-t-transparent border-l-6 border-l-white border-b-4 border-b-transparent ml-1" />
           </div>
        </div>
      </div>
    );
  }

  return (
    <div 
      onClick={() => onPreview({ kind: "media", url, name: message.fileName || "Media", mediaType: "image" })}
      className="relative h-24 w-24 rounded-md overflow-hidden group cursor-pointer"
      style={{ touchAction: "manipulation" }}
    >
      <Image src={url} alt="Media" fill className="object-cover group-hover:scale-105 transition" />
    </div>
  );
}

function GalleryDocItem({ message, onPreview }: { message: any; onPreview: (preview: GalleryPreview) => void }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (message.mediaKey) {
      storeMedia(message.fileUrl, message.mediaKey, message.mimeType || "application/octet-stream")
        .then(decryptedUrl => { if (!cancelled) setUrl(decryptedUrl); })
        .catch(() => { if (!cancelled) setUrl(message.fileUrl); });
    } else {
      setUrl(message.fileUrl);
    }
    return () => { cancelled = true; };
  }, [message.fileUrl, message.mediaKey, message.mimeType]);

  const isAudio = message.type === "audio";

  return (
    <div className="flex items-center p-3 bg-zinc-100 dark:bg-zinc-800/50 rounded-md gap-4">
      <div className="h-10 w-10 bg-indigo-500/10 text-indigo-500 rounded flex items-center justify-center shrink-0">
        {isAudio ? <Headphones className="h-5 w-5" /> : <FileIcon className="h-5 w-5" />}
      </div>
      <div className="flex flex-col flex-1 overflow-hidden">
        <p className="text-sm font-semibold truncate">{message.fileName || (isAudio ? "Audio" : "Document")}</p>
        <p className="text-xs text-zinc-500">{format(new Date(message.createdAt), "MMM d, yyyy")}</p>
      </div>
      {isAudio ? (
        <button
          type="button"
          onClick={() => url && onPreview({ kind: "media", url, name: message.fileName || "Audio", mediaType: "audio" })}
          className="text-zinc-500 hover:text-indigo-500 transition cursor-pointer p-2"
          disabled={!url}
          style={{ touchAction: "manipulation" }}
        >
          <Play className="h-5 w-5" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => url && onPreview({ kind: "doc", url, name: message.fileName || "Document" })}
          className="text-zinc-500 hover:text-indigo-500 transition cursor-pointer p-2"
          disabled={!url}
          style={{ touchAction: "manipulation" }}
        >
          <Download className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}

export function ChatMediaGalleryModal() {
  const { isOpen, onClose, type, data } = useModal();
  const isModalOpen = isOpen && type === "chatMediaGallery";
  const { chatId, isDirect } = data;

  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<GalleryPreview | null>(null);

  useEffect(() => {
    if (isModalOpen && chatId) {
      setLoading(true);
      axios.get(`/api/chat-media?chatId=${chatId}&isDirect=${!!isDirect}&limit=100`)
        .then(res => setMessages(res.data))
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [isModalOpen, chatId, isDirect]);

  if (!isModalOpen) return null;

  const mediaMessages = messages.filter(m => m.fileUrl && m.type !== "document" && m.type !== "audio");
  const docMessages = messages.filter(m => m.fileUrl && (m.type === "document" || m.type === "audio"));
  const linkMessages = messages.filter(m => !m.fileUrl && m.content?.includes("http"));

  // Helper to extract domain from URL
  const extractDomain = (text: string) => {
    try {
      const match = text.match(/(https?:\/\/[^\s]+)/g);
      if (match && match[0]) {
        return new URL(match[0]).hostname;
      }
    } catch {}
    return "Link";
  };
  
  // Helper to extract full url
  const extractUrl = (text: string) => {
    try {
      const match = text.match(/(https?:\/\/[^\s]+)/g);
      if (match && match[0]) return match[0];
    } catch {}
    return "#";
  };

  return (
    <Dialog open={isModalOpen} onOpenChange={onClose}>
      <DialogContent className="bg-white dark:bg-[#313338] text-black dark:text-white p-0 overflow-hidden sm:max-w-[600px] h-[80vh] flex flex-col">
        <DialogHeader className="pt-4 px-4 pb-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={preview ? () => setPreview(null) : onClose}
              className="flex h-12 items-center gap-2 rounded-full bg-zinc-100 px-4 text-sm font-bold text-zinc-800 active:bg-zinc-200 dark:bg-zinc-800 dark:text-white dark:active:bg-zinc-700"
              style={{ touchAction: "manipulation" }}
              aria-label={preview ? "Back to media list" : "Back to chat"}
            >
              <ArrowLeft className="h-5 w-5" />
              Back
            </button>
            <DialogTitle className="text-lg font-bold">
              {preview ? preview.name : "Media, links and docs"}
            </DialogTitle>
          </div>
        </DialogHeader>

        {preview ? (
          <div className="flex-1 min-h-0 px-4 pb-4">
            <div className="relative flex h-full min-h-0 items-center justify-center overflow-hidden rounded-xl bg-black">
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="absolute right-3 top-3 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white active:bg-white/25"
                aria-label="Close preview"
                style={{ touchAction: "manipulation" }}
              >
                <X className="h-6 w-6" />
              </button>
              {preview.kind === "media" && preview.mediaType === "video" ? (
                <video
                  src={preview.url}
                  controls
                  autoPlay
                  playsInline
                  preload="metadata"
                  className="h-full max-h-full w-full max-w-full bg-black object-contain pointer-events-auto"
                  style={{ touchAction: "manipulation", userSelect: "auto" }}
                />
              ) : preview.kind === "media" && preview.mediaType === "audio" ? (
                <div className="flex flex-col items-center justify-center gap-4 text-white">
                  <Headphones className="h-16 w-16 text-indigo-300" />
                  <p className="text-sm font-bold">{preview.name}</p>
                  <audio
                    src={preview.url}
                    controls
                    autoPlay
                    className="pointer-events-auto w-[280px]"
                    style={{ userSelect: "auto" }}
                  />
                </div>
              ) : preview.kind === "media" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview.url} alt={preview.name} className="max-h-full max-w-full object-contain" />
              ) : preview.kind === "doc" ? (
                <div className="flex w-full max-w-sm flex-col items-center gap-4 p-6 text-center text-white">
                  <FileIcon className="h-16 w-16 text-indigo-300" />
                  <p className="text-sm font-bold">{preview.name}</p>
                  <a
                    href={preview.url}
                    download={preview.name}
                    className="flex h-12 items-center justify-center gap-2 rounded-full bg-indigo-600 px-5 text-sm font-bold text-white active:bg-indigo-500"
                    style={{ touchAction: "manipulation" }}
                  >
                    <Download className="h-5 w-5" />
                    Download
                  </a>
                </div>
              ) : (
                <div className="flex w-full max-w-sm flex-col items-center gap-4 p-6 text-center text-white">
                  <LinkIcon className="h-16 w-16 text-sky-300" />
                  <p className="max-w-full break-all text-sm">{preview.url}</p>
                </div>
              )}
            </div>
          </div>
        ) : (
        <Tabs defaultValue="media" className="flex-1 flex flex-col px-4 pb-4">
          <TabsList className="w-full bg-zinc-100 dark:bg-zinc-800 mb-4">
            <TabsTrigger value="media" className="flex-1">Media</TabsTrigger>
            <TabsTrigger value="docs" className="flex-1">Docs</TabsTrigger>
            <TabsTrigger value="links" className="flex-1">Links</TabsTrigger>
          </TabsList>

          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
            </div>
          ) : (
            <>
              <TabsContent value="media" className="flex-1 m-0 h-full">
                <ScrollArea className="h-[calc(80vh-140px)] w-full pr-4">
                  {mediaMessages.length === 0 ? (
                    <div className="text-center text-zinc-500 py-10">No media found</div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {mediaMessages.map(msg => (
                        <GalleryMediaItem key={msg.id} message={msg} onPreview={setPreview} />
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>

              <TabsContent value="docs" className="flex-1 m-0 h-full">
                <ScrollArea className="h-[calc(80vh-140px)] w-full pr-4">
                  {docMessages.length === 0 ? (
                    <div className="text-center text-zinc-500 py-10">No documents found</div>
                  ) : (
                    <div className="space-y-3">
                      {docMessages.map(msg => (
                        <GalleryDocItem key={msg.id} message={msg} onPreview={setPreview} />
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>

              <TabsContent value="links" className="flex-1 m-0 h-full">
                <ScrollArea className="h-[calc(80vh-140px)] w-full pr-4">
                  {linkMessages.length === 0 ? (
                    <div className="text-center text-zinc-500 py-10">No links found</div>
                  ) : (
                    <div className="space-y-3">
                      {linkMessages.map(msg => {
                        const url = extractUrl(msg.content);
                        return (
                          <div key={msg.id} className="flex items-center p-3 bg-zinc-100 dark:bg-zinc-800/50 rounded-md gap-4">
                            <div className="h-10 w-10 bg-sky-500/10 text-sky-500 rounded flex items-center justify-center shrink-0">
                              <LinkIcon className="h-5 w-5" />
                            </div>
                            <div className="flex flex-col flex-1 overflow-hidden">
                              <button
                                type="button"
                                onClick={() => setPreview({ kind: "link", url, name: extractDomain(msg.content) })}
                                className="text-left text-sm font-semibold text-sky-500 hover:underline truncate"
                                style={{ touchAction: "manipulation" }}
                              >
                                {msg.content}
                              </button>
                              <p className="text-xs text-zinc-500 mt-1 flex gap-2">
                                <span>{extractDomain(msg.content)}</span>
                                <span>•</span>
                                <span>{format(new Date(msg.createdAt), "MMM d, yyyy")}</span>
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>
            </>
          )}
        </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
