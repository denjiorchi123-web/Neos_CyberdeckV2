"use client";

import { Member, Profile } from "@prisma/client";
import { useSearchParams } from "next/navigation";

import { ChatHeader } from "@/components/chat/chat-header";
import { ChatMessages } from "@/components/chat/chat-messages";
import { ChatInput } from "@/components/chat/chat-input";
import { MediaRoom } from "@/components/media-room";

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
  const isInitiator = searchParams?.get("start") === "true";
  const callId = searchParams?.get("callId");

  return (
    <div className="flex flex-col h-full bg-[#313338] relative overflow-hidden">
      <ChatHeader
        name={name}
        serverId={member.serverId}
        type={type}
        chatId={chatId}
        currentProfileName={profile.name}
        callerMemberId={member.id}
      />

      {(video || audio) ? (
        <div className="flex-1 min-h-0">
          <MediaRoom
            chatId={chatId}
            video={video}
            audio={audio}
            currentProfileName={profile.name}
            isInitiator={isInitiator}
            serverId={member.serverId}
            callerMemberId={member.id}
            callId={callId || undefined}
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
