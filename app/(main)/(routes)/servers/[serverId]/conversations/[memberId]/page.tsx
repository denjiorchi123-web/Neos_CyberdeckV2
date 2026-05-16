import React from "react";
import { redirect } from "next/navigation";

import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";
import { getOrCreateConversation } from "@/lib/conversation";
import { ChatHeader } from "@/components/chat/chat-header";
import { ChatMessages } from "@/components/chat/chat-messages";
import { ChatInput } from "@/components/chat/chat-input";
import { MediaRoom } from "@/components/media-room";

interface MemberIdPageProps {
  params: {
    memberId: string;
    serverId: string;
  };
  searchParams: {
    video?: boolean;
    audio?: boolean;
    start?: boolean;
    callId?: string;
  };
}

export default async function MemberIdPage({
  params: { memberId, serverId },
  searchParams: { video, audio, start, callId }
}: MemberIdPageProps) {
  const profile = await currentProfile();

  if (!profile) return redirect("/");

  const currentMember = await db.member.findFirst({
    where: {
      serverId,
      profileId: profile.id
    },
    include: {
      profile: true
    }
  });

  if (!currentMember) return redirect("/");

  const conversation = await getOrCreateConversation(
    currentMember.id,
    memberId
  );

  if (!conversation) return redirect(`/servers/${serverId}`);

  const { memberOne, memberTwo } = conversation;

  const otherMember =
    memberOne.profileId === profile.id ? memberTwo : memberOne;

  const isInCall = !!(video || audio);

  return (
    <div className="bg-white dark:bg-[#313338] flex flex-col h-full">
      <ChatHeader
        imageUrl={otherMember.profile.imageUrl}
        name={otherMember.profile.name}
        serverId={serverId}
        type="conversation"
        chatId={conversation.id}
        otherMemberId={memberId}
        callerMemberId={currentMember.id}
        currentProfileName={profile.name}
      />

      {/* MediaRoom renders fixed inset-0 z-50 — it covers the chat while the call is active.
          When it unmounts (call ends / URL params removed), the chat below becomes visible. */}
      {isInCall && (
        <MediaRoom
          chatId={conversation.id}
          video={!!video}
          audio={true}
          peerName={otherMember.profile.name}
          peerImageUrl={otherMember.profile.imageUrl}
          currentProfileName={profile.name}
          isInitiator={!!start}
          serverId={serverId}
          callerMemberId={currentMember.id}
          callId={callId}
          callerUserId={profile.id}
          targetUserId={otherMember.profile.id}
        />
      )}

      {/* Chat — always in the DOM so the history is ready the instant the call ends */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <ChatMessages
          member={currentMember}
          name={otherMember.profile.name}
          chatId={conversation.id}
          type="conversation"
          apiUrl="/api/direct-messages"
          paramKey="conversationId"
          paramValue={conversation.id}
          socketUrl="/api/socket/direct-messages"
          socketQuery={{
            conversationId: conversation.id
          }}
        />
        <ChatInput
          name={otherMember.profile.name}
          type="conversation"
          apiUrl="/api/socket/direct-messages"
          query={{
            conversationId: conversation.id
          }}
        />
      </div>
    </div>
  );
}
