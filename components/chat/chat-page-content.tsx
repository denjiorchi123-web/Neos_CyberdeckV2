"use client";

import { Member, Profile } from "@prisma/client";
import { useSearchParams } from "next/navigation";

import { ChatHeader } from "@/components/chat/chat-header";
import { ChatMessages } from "@/components/chat/chat-messages";
import { ChatInput } from "@/components/chat/chat-input";
import { MediaRoom } from "@/components/media-room";
import { useCall } from "@/hooks/use-call";
import { IncomingCallOverlay } from "@/components/incoming-call-overlay";
import { OutgoingCallOverlay } from "@/components/outgoing-call-overlay";
import { cn } from "@/lib/utils";

interface ChatPageContentProps {
  profile: Profile;
  member: Member;
  name: string;
  chatId: string;
  type: "channel" | "conversation";
  apiUrl: string;
  socketUrl: string;
  socketQuery: Record<string, string>;
  paramKey: "channelId" | "conversationId";
  paramValue: string;
}

export const ChatPageContent = ({
  profile,
  member,
  name,
  chatId,
  type,
  apiUrl,
  socketUrl,
  socketQuery,
  paramKey,
  paramValue,
}: ChatPageContentProps) => {
  const searchParams = useSearchParams();
  const video = searchParams?.get("video") === "true";
  const audio = searchParams?.get("audio") === "true";
  
  const { status } = useCall();

  return (
    <div className="flex flex-col h-full bg-[#313338] relative overflow-hidden">
      <ChatHeader
        name={name}
        serverId={member.serverId}
        type={type}
      />
      
      {/* Call Overlays */}
      <IncomingCallOverlay />
      <OutgoingCallOverlay />

      {(video || audio) ? (
        <div className="flex-1 min-h-0">
           <MediaRoom
            chatId={chatId}
            video={video}
            audio={audio}
          />
        </div>
      ) : (
        <>
          <ChatMessages
            member={member}
            name={name}
            chatId={chatId}
            type={type}
            apiUrl={apiUrl}
            socketUrl={socketUrl}
            socketQuery={socketQuery}
            paramKey={paramKey}
            paramValue={paramValue}
          />
          <ChatInput
            name={name}
            type={type}
            apiUrl={apiUrl}
            query={socketQuery}
          />
        </>
      )}
    </div>
  );
};
