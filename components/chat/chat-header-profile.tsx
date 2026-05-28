"use client";

import React from "react";
import { Hash } from "lucide-react";
import { useModal } from "@/hooks/use-modal-store";
import { UserAvatar } from "@/components/user-avatar";
import { ChatHeaderStatus } from "@/components/chat/chat-header-status";

interface ChatHeaderProfileProps {
  name: string;
  serverId: string;
  type: "channel" | "conversation";
  imageUrl?: string;
  otherMemberId?: string;
}

export function ChatHeaderProfile({
  name,
  serverId,
  type,
  imageUrl,
  otherMemberId
}: ChatHeaderProfileProps) {
  const { onOpen } = useModal();

  const handleInfoClick = () => {
    onOpen("chatInfo", {
      chatType: type === "channel" ? "group" : "dm",
      chatName: name,
      chatImage: imageUrl,
      memberId: otherMemberId,
      server: { id: serverId } as any // Pass serverId to fetch group members
    });
  };

  return (
    <div 
      onClick={handleInfoClick} 
      className="flex items-center cursor-pointer hover:bg-zinc-700/10 dark:hover:bg-zinc-700/50 p-1 rounded-md transition-colors"
    >
      {type === "channel" && (
        <Hash className="w-5 h-5 text-zinc-500 dark:text-zinc-400 mr-2" />
      )}
      {type === "conversation" && (
        <UserAvatar
          src={imageUrl}
          className="h-8 w-8 md:h-8 md:w-8 mr-2"
        />
      )}
      <div className="flex flex-col">
        <p className="font-semibold text-md text-black dark:text-white leading-tight">
          {name}
        </p>
        {type === "conversation" && (
          <ChatHeaderStatus otherMemberId={otherMemberId} />
        )}
      </div>
    </div>
  );
}
