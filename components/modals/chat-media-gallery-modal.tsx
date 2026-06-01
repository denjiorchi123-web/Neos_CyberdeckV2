"use client";

import React, { useEffect, useState } from "react";
import axios from "axios";
import { format } from "date-fns";
import { FileIcon, LinkIcon, Download, Loader2 } from "lucide-react";

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
function GalleryMediaItem({ message }: { message: any }) {
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
        onClick={() => window.open(url, "_blank")} 
        className="relative h-24 w-24 rounded-md overflow-hidden bg-black group cursor-pointer"
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
      onClick={() => window.open(url, "_blank")}
      className="relative h-24 w-24 rounded-md overflow-hidden group cursor-pointer"
    >
      <Image src={url} alt="Media" fill className="object-cover group-hover:scale-105 transition" />
    </div>
  );
}

export function ChatMediaGalleryModal() {
  const { isOpen, onClose, type, data } = useModal();
  const isModalOpen = isOpen && type === "chatMediaGallery";
  const { chatId, isDirect } = data;

  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

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
        <DialogHeader className="pt-6 px-6 pb-2">
          <DialogTitle className="text-xl font-bold">Media, links and docs</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="media" className="flex-1 flex flex-col px-6 pb-6">
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
                        <GalleryMediaItem key={msg.id} message={msg} />
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
                        <div key={msg.id} className="flex items-center p-3 bg-zinc-100 dark:bg-zinc-800/50 rounded-md gap-4">
                          <div className="h-10 w-10 bg-indigo-500/10 text-indigo-500 rounded flex items-center justify-center shrink-0">
                            <FileIcon className="h-5 w-5" />
                          </div>
                          <div className="flex flex-col flex-1 overflow-hidden">
                            <p className="text-sm font-semibold truncate">{msg.fileName || "Document"}</p>
                            <p className="text-xs text-zinc-500">{format(new Date(msg.createdAt), "MMM d, yyyy")}</p>
                          </div>
                          <a href={msg.fileUrl} download={msg.fileName || "download"} target="_blank" rel="noreferrer" className="text-zinc-500 hover:text-indigo-500 transition cursor-pointer p-2">
                            <Download className="h-5 w-5" />
                          </a>
                        </div>
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
                              <a href={url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-sky-500 hover:underline truncate">
                                {msg.content}
                              </a>
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
      </DialogContent>
    </Dialog>
  );
}
