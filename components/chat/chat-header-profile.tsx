"use client";

import React from "react";
import { Hash } from "lucide-react";
import { useModal } from "@/hooks/use-modal-store";
import { UserAvatar } from "@/components/user-avatar";
import { usePreferences, usePresence } from "@/components/providers/socket-provider";

interface ChatHeaderProfileProps {
  name: string;
  serverId: string;
  type: "channel" | "conversation";
  imageUrl?: string;
  otherMemberId?: string;
  otherProfileId?: string;
}

export function ChatHeaderProfile({
  name,
  serverId,
  type,
  imageUrl,
  otherMemberId,
  otherProfileId
}: ChatHeaderProfileProps) {
  const { onOpen } = useModal();
  const { blockedUsers, blockedBy } = usePreferences();
  const { onlineUsers } = usePresence();

  const isBlocked = otherProfileId && (
    blockedUsers.some(u => u.blockedId === otherProfileId) ||
    blockedBy.some(u => u.blockerId === otherProfileId)
  );

  const isOnline = otherProfileId ? onlineUsers.some((u: any) => u.userId === otherProfileId) : false;

  const displayImageUrl = isBlocked ? undefined : imageUrl;

  const handleInfoClick = () => {
    onOpen("chatInfo", {
      chatType: type === "channel" ? "group" : "dm",
      chatName: name,
      chatImage: displayImageUrl,
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
          src={displayImageUrl}
          className="h-8 w-8 md:h-8 md:w-8 mr-2"
          status={isOnline && !isBlocked ? "online" : "offline"}
        />
      )}
      <div className="flex flex-col">
        <p className="font-semibold text-md text-black dark:text-white leading-tight">
          {name}
        </p>
        {type === "conversation" && (
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-tight">
            {isOnline && !isBlocked ? "● online" : "○ offline"}
          </p>
        )}
      </div>
    </div>
  );
}
