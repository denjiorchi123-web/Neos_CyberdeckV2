import React from "react";
import { redirect } from "next/navigation";
import { MessageSquare, Plus } from "lucide-react";


import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";
import { formatChatTime } from "@/lib/format-chat-time";
import { UnifiedChatList } from "./unified-chat-list";
import { UnifiedChatHeaderAction } from "./unified-chat-header-action";
import { ActionTooltip } from "@/components/action-tooltip";
import { NavigationUserControl } from "./navigation-user-control";

export async function UnifiedChatSidebar() {
  const profile = await currentProfile();

  if (!profile) return redirect("/sign-in");

  const archivedChats = await db.archivedChat.findMany({
    where: { profileId: profile.id }
  });
  const archivedChatIds = new Set(archivedChats.map(a => a.chatId));

  const pinnedChats = await db.pinnedChat.findMany({
    where: { profileId: profile.id }
  });
  const pinnedChatIds = new Set(pinnedChats.map(p => p.chatId));

  // Get 1-on-1s (Direct Messages)
  const defaultServer = await db.server.findFirst({
    where: { inviteCode: "cyberdeck-default" },
    include: { members: { where: { profileId: profile.id } } }
  });
  
  const currentMember = defaultServer?.members[0];
  let dmChats: any[] = [];

  if (defaultServer && currentMember) {
    const members = await db.member.findMany({
      where: {
        serverId: defaultServer.id,
        NOT: { profileId: profile.id }
      },
      include: { profile: true },
      orderBy: { profile: { name: "asc" } }
    });

    // Fetch conversations to get last messages
    for (const member of members) {
      const conversation = await db.conversation.findFirst({
        where: {
          OR: [
            { memberOneId: currentMember.id, memberTwoId: member.id },
            { memberOneId: member.id, memberTwoId: currentMember.id }
          ]
        },
        include: {
          directMessages: {
            orderBy: { createdAt: "desc" },
            take: 1
          }
        }
      });

      const lastMessage = conversation?.directMessages[0]?.content || null;
      const lastMessageTime = conversation?.directMessages[0]?.createdAt || null;
      const lastMessageStatus = conversation?.directMessages[0]?.status || null;
      const lastMessageMemberId = conversation?.directMessages[0]?.memberId || null;
      const amILastSender = lastMessageMemberId === currentMember.id;

      dmChats.push({
        id: member.id, // For DM routing, we need the memberId
        name: member.profile.name,
        imageUrl: member.profile.imageUrl,
        type: "DM",
        lastMessage,
        lastMessageTime,
        lastMessageTimeLabel: formatChatTime(lastMessageTime),
        lastMessageStatus,
        amILastSender,
        serverId: defaultServer.id,
        isArchived: archivedChatIds.has(member.id),
        isPinned: pinnedChatIds.has(member.id)
      });
    }
  }

  // Get Group Chats (Text channels from other servers)
  const servers = await db.server.findMany({
    where: {
      members: { some: { profileId: profile.id } },
      NOT: { inviteCode: "cyberdeck-default" }
    },
    include: {
      members: true,
      channels: {
        where: { type: "TEXT" },
        include: {
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1
          }
        }
      },
      community: true
    }
  });

  let groupChats: any[] = [];
  servers.forEach(server => {
    server.channels.forEach(channel => {
      const lastMessage = channel.messages[0]?.content || null;
      const lastMessageTime = channel.messages[0]?.createdAt || null;
      // Group chats don't have a single 'status' field for read receipts usually, but we can map it if we want.
      // For now, let's just see if we are the sender.
      const lastMessageMemberId = channel.messages[0]?.memberId || null;
      const amILastSender = server.members.find(m => m.profileId === profile.id)?.id === lastMessageMemberId;

      groupChats.push({
        id: channel.id,
        name: server.name, // Group name = Server name in this UI
        channelName: channel.name,
        imageUrl: server.imageUrl,
        type: "GROUP",
        lastMessage,
        lastMessageTime,
        lastMessageTimeLabel: formatChatTime(lastMessageTime),
        lastMessageStatus: channel.messages[0]?.status || null,
        amILastSender,
        serverId: server.id,
        communityId: server.community?.id,
        communityImageUrl: server.community?.imageUrl,
        isArchived: archivedChatIds.has(channel.id),
        isPinned: pinnedChatIds.has(channel.id)
      });
    });
  });

  // Get Communities
  const communityData = await db.community.findMany({
    where: { profileId: profile.id },
    include: { groups: true }
  });

  let communityChats: any[] = communityData.map((comm) => ({
    id: comm.id,
    name: comm.name,
    imageUrl: comm.imageUrl,
    type: "COMMUNITY",
    lastMessage: `Includes ${comm.groups.length} group(s)`,
    lastMessageTime: comm.createdAt,
    lastMessageTimeLabel: formatChatTime(comm.createdAt),
    serverId: comm.id, // used for routing later
    isArchived: archivedChatIds.has(comm.id),
    isPinned: pinnedChatIds.has(comm.id)
  }));

  // Get Broadcast Channels
  const broadcastData = await db.broadcastChannel.findMany({
    where: { 
      OR: [
        { profileId: profile.id },
        { followers: { some: { profileId: profile.id } } }
      ]
    },
    include: {
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
      community: true
    }
  });

  let broadcastChats: any[] = broadcastData.map((channel) => {
    const lastMessageTime = channel.messages[0]?.createdAt || channel.createdAt;
    return {
      id: channel.id,
      name: channel.name,
      imageUrl: channel.imageUrl,
      type: "CHANNEL",
      lastMessage: channel.messages[0]?.content || "No messages yet",
      lastMessageTime,
      lastMessageTimeLabel: formatChatTime(lastMessageTime),
      serverId: channel.id,
      isArchived: archivedChatIds.has(channel.id),
      isPinned: pinnedChatIds.has(channel.id)
    };
  });

  // Sort all chats by pinned status first, then by most recent message, then alphabetically
  const allChats = [...dmChats, ...groupChats, ...communityChats, ...broadcastChats].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;

    if (a.lastMessageTime && b.lastMessageTime) {
      return b.lastMessageTime.getTime() - a.lastMessageTime.getTime();
    }
    if (a.lastMessageTime) return -1;
    if (b.lastMessageTime) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="flex flex-col h-full text-primary w-full dark:bg-[#2b2d31] bg-[#f2f3f5] border-r border-neutral-200 dark:border-neutral-800">
      <div className="px-4 h-14 flex items-center justify-between border-b-2 border-neutral-200 dark:border-neutral-800 shadow-sm">
        <h1 className="text-lg font-semibold text-black dark:text-white flex items-center gap-x-2">
          Chats
        </h1>
        <div className="flex items-center gap-x-2">
          <UnifiedChatHeaderAction />
        </div>
      </div>
      
      <UnifiedChatList chats={allChats} />
    </div>
  );
}
