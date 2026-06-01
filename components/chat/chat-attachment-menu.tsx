"use client";

import React, { useState } from "react";
import {
  FileText,
  Image as ImageIcon,
  Headphones,
  Video,
  Camera,
  MapPin,
  User,
  Plus
} from "lucide-react";
import { motion } from "framer-motion";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useModal } from "@/hooks/use-modal-store";
import { CameraCapture } from "@/components/chat/camera-capture";
import { LocationShare } from "@/components/chat/location-share";
import { ContactShare } from "@/components/chat/contact-share";
import qs from "query-string";
import axios from "axios";

interface ChatAttachmentMenuProps {
  apiUrl: string;
  query: Record<string, string>;
  replyToId?: string;
  onSent?: () => void;
}

type OverlayType = "camera" | "location" | "contact" | null;

export function ChatAttachmentMenu({ apiUrl, query, replyToId, onSent }: ChatAttachmentMenuProps) {
  const { onOpen } = useModal();
  const [overlay, setOverlay] = useState<OverlayType>(null);
  const [open,    setOpen]    = useState(false);

  // Send a message with optional file metadata
  const sendMessage = async (payload: {
    content: string;
    fileUrl?: string;
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
    thumbnailUrl?: string;
    mediaKey?: string;
    type?: string;
  }) => {
    const url = qs.stringifyUrl({ url: apiUrl, query });
    await axios.post(url, { ...payload, replyToId });
    if (onSent) onSent();
  };

  const options = [
    {
      label: "Document",
      icon: <FileText className="h-6 w-6 text-white" />,
      color: "bg-indigo-500",
      onClick: () => {
        setOpen(false);
        onOpen("messageFile", { apiUrl, query, fileType: "document", replyToId });
      }
    },
    {
      label: "Camera",
      icon: <Camera className="h-6 w-6 text-white" />,
      color: "bg-pink-500",
      onClick: () => { setOpen(false); setOverlay("camera"); }
    },
    {
      label: "Gallery",
      icon: <ImageIcon className="h-6 w-6 text-white" />,
      color: "bg-purple-500",
      onClick: () => {
        setOpen(false);
        onOpen("messageFile", { apiUrl, query, fileType: "image", replyToId });
      }
    },
    {
      label: "Audio",
      icon: <Headphones className="h-6 w-6 text-white" />,
      color: "bg-orange-500",
      onClick: () => {
        setOpen(false);
        onOpen("messageFile", { apiUrl, query, fileType: "audio", replyToId });
      }
    },
    {
      label: "Video",
      icon: <Video className="h-6 w-6 text-white" />,
      color: "bg-red-500",
      onClick: () => {
        setOpen(false);
        onOpen("messageFile", { apiUrl, query, fileType: "video", replyToId });
      }
    },
    {
      label: "Location",
      icon: <MapPin className="h-6 w-6 text-white" />,
      color: "bg-emerald-500",
      onClick: () => { setOpen(false); setOverlay("location"); }
    },
    {
      label: "Contact",
      icon: <User className="h-6 w-6 text-white" />,
      color: "bg-blue-500",
      onClick: () => { setOpen(false); setOverlay("contact"); }
    }
  ];

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="absolute top-1/2 -translate-y-1/2 left-4 h-[24px] w-[24px] bg-zinc-500 dark:bg-zinc-400 hover:bg-zinc-600 dark:hover:bg-zinc-300 transition rounded-full p-1 flex items-center justify-center"
          >
            <Plus className="text-white dark:text-[#313338]" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          className="bg-transparent border-none shadow-none w-auto p-0 mb-4"
        >
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="bg-[#232428] border border-white/5 rounded-2xl p-4 grid grid-cols-3 gap-4 shadow-2xl"
          >
            {options.map((option) => (
              <motion.button
                key={option.label}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                onClick={option.onClick}
                className="flex flex-col items-center gap-y-2 group"
                type="button"
              >
                <div className={`${option.color} p-4 rounded-full shadow-lg shadow-black/20 group-hover:brightness-110 transition`}>
                  {option.icon}
                </div>
                <span className="text-[10px] font-bold text-zinc-400 group-hover:text-white uppercase tracking-tighter transition">
                  {option.label}
                </span>
              </motion.button>
            ))}
          </motion.div>
        </PopoverContent>
      </Popover>

      {/* Full-screen overlays — rendered outside the Popover so z-index works correctly */}
      {overlay === "camera" && (
        <CameraCapture
          apiUrl={apiUrl}
          query={query}
          onClose={() => setOverlay(null)}
          onSend={async (payload) => { await sendMessage(payload); }}
        />
      )}

      {overlay === "location" && (
        <LocationShare
          onClose={() => setOverlay(null)}
          onSend={async (payload) => { await sendMessage(payload); }}
        />
      )}

      {overlay === "contact" && (
        <ContactShare
          onClose={() => setOverlay(null)}
          onSend={async (payload) => { await sendMessage(payload); }}
        />
      )}
    </>
  );
}
