import React from "react";
import { Hash } from "lucide-react";

import { MobileToggle } from "@/components/mobile-toggle";
import { UserAvatar } from "@/components/user-avatar";
import { SocketIndicatior } from "@/components/socket-indicatior";
import { ChatVideoButton } from "@/components/chat/chat-video-button";
import { ChatAudioButton } from "@/components/chat/chat-audio-button";
import { ChatHeaderStatus } from "@/components/chat/chat-header-status";

interface ChatHeaderProps {
  serverId: string;
  name: string;
  type: "channel" | "conversation";
  imageUrl?: string;
  chatId?: string;
  otherMemberId?: string;
  callerMemberId?: string;
  currentProfileName?: string;
}

export function ChatHeader({
  name,
  serverId,
  type,
  imageUrl,
  chatId,
  otherMemberId,
  callerMemberId,
  currentProfileName
}: ChatHeaderProps) {
  return (
    <div className="text-md font-semibold px-3 flex items-center h-12 border-neutral-200 dark:border-neutral-800 border-b-2">
      <MobileToggle serverId={serverId} />
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
      <div className="ml-auto flex items-center">
        {type === "conversation" && (
          <>
            <ChatAudioButton 
              chatId={chatId} 
              name={name} 
              serverId={serverId}
              otherMemberId={otherMemberId}
              callerMemberId={callerMemberId}
              currentProfileName={currentProfileName}
            />
            <ChatVideoButton 
              chatId={chatId} 
              name={name} 
              serverId={serverId}
              otherMemberId={otherMemberId}
              callerMemberId={callerMemberId}
              currentProfileName={currentProfileName}
            />
          </>
        )}
        <SocketIndicatior />
      </div>
    </div>
  );
}
