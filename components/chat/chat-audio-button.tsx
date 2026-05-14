"use client";

import React from "react";
import { Phone, PhoneOff } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import qs from "query-string";
import axios from "axios";
import { useSocket } from "@/components/providers/socket-provider";

import { ActionTooltip } from "@/components/action-tooltip";

interface ChatAudioButtonProps {
  chatId?: string;
  name?: string;
  serverId?: string;
  otherMemberId?: string;
  callerMemberId?: string;
  currentProfileName?: string;
}

export function ChatAudioButton({ 
  chatId, 
  name,
  serverId,
  otherMemberId,
  callerMemberId,
  currentProfileName
}: ChatAudioButtonProps) {
  const { socket } = useSocket();
  const searchParams = useSearchParams();
  const pathName = usePathname();
  const router = useRouter();

  const isAudio = searchParams?.get("audio") && !searchParams?.get("video");

  const Icon = isAudio ? PhoneOff : Phone;
  const tooltipLabel = isAudio ? "End audio call" : "Start audio call";

  const onClick = () => {
    const isStarting = !isAudio;
    
    if (isStarting && socket && chatId) {
      socket.emit("call:start", {
        chatId,
        callerName: currentProfileName || "Someone",
        type: "audio",
        serverId,
        callerMemberId, // Correctly pass the ID for recipient to reply to
      });

      // Log the start of the call in the chat history
      axios.post(`/api/socket/direct-messages?conversationId=${chatId}`, {
        content: "📞 Voice call started",
      }).catch(() => {});
    }

    const url = qs.stringifyUrl(
      {
        url: pathName || "",
        query: {
          audio: isStarting ? true : undefined,
          video: undefined // Ensure video is off
        }
      },
      { skipNull: true }
    );

    setTimeout(() => {
      router.push(url);
    }, 500);
  };

  return (
    <ActionTooltip side="bottom" label={tooltipLabel}>
      <button
        onClick={onClick}
        className="hover:opacity-75 transition mr-4"
      >
        <Icon className="h-5 w-5 text-zinc-500 dark:text-zinc-400" />
      </button>
    </ActionTooltip>
  );
}
