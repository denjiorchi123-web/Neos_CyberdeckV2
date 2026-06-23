import React from "react";
import { redirect } from "next/navigation";
import { ChannelType } from "@/lib/db-enums";

import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";
import { ChatHeader } from "@/components/chat/chat-header";
import { ChatInput } from "@/components/chat/chat-input";
import { ChatMessages } from "@/components/chat/chat-messages";
import { MediaRoom } from "@/components/media-room";
import { ChatLockGuard } from "@/components/chat/chat-lock-guard";


interface ChannelIdPageProps {
  params: {
    serverId: string;
    channelId: string;
  };
  searchParams: {
    video?: boolean;
    audio?: boolean;
  };
}

export default async function ChannelIdPage({
  params: { channelId, serverId },
  searchParams
}: ChannelIdPageProps) {
  const profile = await currentProfile();

  if (!profile) return redirect("/");



  const channel = await db.channel.findFirst({
    where: { id: channelId, serverId }
  });

  const server = await db.server.findUnique({
    where: { id: serverId },
    include: {
      members: {
        include: { profile: true },
        orderBy: { role: "asc" }
      }
    }
  });

  const member = await db.member.findFirst({
    where: { serverId: serverId, profileId: profile.id }
  });

  if (!channel || !member || !server) return redirect("/");

  return (
    <div className="bg-white dark:bg-[#313338] flex flex-col h-full min-h-0 overflow-hidden">
      <ChatHeader
        name={channel.name}
        serverId={channel.serverId}
        type="channel"
        server={server}
        role={member.role}
      />
      <ChatLockGuard chatId={channel.id}>
        {!searchParams.video && !searchParams.audio && (
          <>
            <ChatMessages
              member={member}
              name={channel.name}
              chatId={channel.id}
              type="channel"
              apiUrl="/api/messages"
              socketUrl="/api/socket/messages"
              socketQuery={{
                channelId: channel.id,
                serverId: channel.serverId
              }}
              paramKey="channelId"
              paramValue={channel.id}
            />
            <ChatInput
              name={channel.name}
              type="channel"
              apiUrl="/api/socket/messages"
              query={{
                channelId: channel.id,
                serverId: channel.serverId
              }}
            />
          </>
        )}
        {(searchParams.video || searchParams.audio) && (
          <MediaRoom 
            chatId={channel.id} 
            video={!!searchParams.video} 
            audio={true} 
            peerName={channel.name} 
          />
        )}
      </ChatLockGuard>
    </div>
  );
}
