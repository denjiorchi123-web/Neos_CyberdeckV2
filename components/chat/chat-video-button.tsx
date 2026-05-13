"use client";

import React from "react";
import { Video, VideoOff } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import qs from "query-string";
import { useSocket } from "@/components/providers/socket-provider";

import { ActionTooltip } from "@/components/action-tooltip";

interface ChatVideoButtonProps {
  chatId?: string;
  name?: string;
}

export function ChatVideoButton({ chatId, name }: ChatVideoButtonProps) {
  const { socket } = useSocket();
  const searchParams = useSearchParams();
  const pathName = usePathname();
  const router = useRouter();

  const isVideo = searchParams?.get("video");

  const Icon = isVideo ? VideoOff : Video;
  const tooltipLabel = isVideo ? "End video call" : "Start video call";

  const onClick = () => {
    const isStarting = !isVideo;
    
    // If we are starting a call, notify the other peer via Socket.io
    if (isStarting && socket && chatId) {
      socket.emit("call:start", {
        chatId,
        callerName: "Someone", // Ideally we'd pass the current user's name here
        type: "video"
      });
    }

    const url = qs.stringifyUrl(
      {
        url: pathName || "",
        query: {
          video: isStarting ? true : undefined
        }
      },
      { skipNull: true }
    );

    router.push(url);
  };

  return (
    <ActionTooltip side="bottom" label={tooltipLabel}>
      <button
        onClick={onClick}
        className="hover:opacity-75 transition mr-4"
      >
        <Icon className="h-6 w-6 text-zinc-500 dark:text-zinc-400" />
      </button>
    </ActionTooltip>
  );
}
