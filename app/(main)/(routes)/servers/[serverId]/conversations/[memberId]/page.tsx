import React from "react";
import { redirect } from "next/navigation";

import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";
import { getOrCreateConversation } from "@/lib/conversation";
import { ChatHeader } from "@/components/chat/chat-header";
import { ChatMessages } from "@/components/chat/chat-messages";
import { ChatInput } from "@/components/chat/chat-input";
import { MediaRoom } from "@/components/media-room";
import { cn } from "@/lib/utils";

interface MemberIdPageProps {
  params: {
    memberId: string;
    serverId: string;
  };
  searchParams: {
    video?: boolean;
    audio?: boolean;
  };
}

export default async function MemberIdPage({
  params: { memberId, serverId },
  searchParams: { video, audio }
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
      {/* Call Interface (Voice or Video) */}
      {(video || audio) && (
        <div className={cn(
          "flex-shrink-0 border-b border-black/20 bg-black/5",
          video ? "h-[60vh] min-h-[400px]" : "h-[200px]"
        )}>
          <MediaRoom 
            chatId={conversation.id} 
            video={!!video} 
            audio={true} 
          />
        </div>
      )}

      {/* Chat History & Input (Always Visible) */}
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
