import React from "react";
import { Hash } from "lucide-react";

import { MobileToggle } from "@/components/mobile-toggle";
import { SocketIndicatior } from "@/components/socket-indicatior";
import { ChatVideoButton } from "@/components/chat/chat-video-button";
import { ChatAudioButton } from "@/components/chat/chat-audio-button";
import { ChatHeaderProfile } from "@/components/chat/chat-header-profile";
import { ServerHeaderAction } from "@/components/server/server-header-action";

interface ChatHeaderProps {
  serverId: string;
  name: string;
  type: "channel" | "conversation";
  imageUrl?: string;
  chatId?: string;
  otherMemberId?: string;
  callerMemberId?: string;
  currentProfileName?: string;
  server?: any; // To avoid circular types here
  role?: string;
}

export function ChatHeader({
  name,
  serverId,
  type,
  imageUrl,
  chatId,
  otherMemberId,
  callerMemberId,
  currentProfileName,
  server,
  role
}: ChatHeaderProps) {
  return (
    <div className="text-md font-semibold px-3 flex items-center h-12 border-neutral-200 dark:border-neutral-800 border-b-2">
      <MobileToggle />
      <ChatHeaderProfile 
        name={name}
        serverId={serverId}
        type={type}
        imageUrl={imageUrl}
        otherMemberId={otherMemberId}
      />
      <div className="ml-auto flex items-center">
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
        <SocketIndicatior />
        {server && <ServerHeaderAction server={server} role={role} />}
      </div>
    </div>
  );
}
