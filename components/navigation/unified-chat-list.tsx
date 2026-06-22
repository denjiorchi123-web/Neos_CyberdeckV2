"use client";

import React, { useEffect, useRef, useTransition } from "react";
import { useParams, useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { Check, CheckCheck, Megaphone, Users, User, Trash, Edit, Phone, Video, Archive, ArchiveRestore, Pin, PinOff, MessageSquare, Lock, BellOff } from "lucide-react";
import { useChatFilterStore } from "@/hooks/use-chat-filter-store";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useModal } from "@/hooks/use-modal-store";
import { usePresence, useSocket } from "@/components/providers/socket-provider";
import axios from "axios";

interface ChatItem {
  id: string; // memberId for DM, channelId for GROUP
  profileId?: string; // profileId of the other member for DM
  name: string;
  channelName?: string;
  imageUrl?: string;
  type: "DM" | "GROUP" | "COMMUNITY" | "CHANNEL";
  lastMessage: string | null;
  lastMessageTime?: Date | string | null;
  lastMessageTimeLabel?: string;
  lastMessageStatus?: "SENT" | "DELIVERED" | "READ" | null;
  amILastSender?: boolean;
  serverId: string;
  communityId?: string;
  communityImageUrl?: string | null;
  isArchived?: boolean;
  isPinned?: boolean;
  isLocked?: boolean;
  isMuted?: boolean;
}

interface UnifiedChatListProps {
  chats: ChatItem[];
}

import { useDragScroll } from "@/hooks/use-drag-scroll";

export function UnifiedChatList({ chats }: UnifiedChatListProps) {
  const router = useRouter();
  const params = useParams();
  const [isPending, startTransition] = useTransition();
  const { onOpen } = useModal();
  const { onlineUsers } = usePresence();
  const { socket } = useSocket();
  const { searchTerm, setSearchTerm, activeTab, setActiveTab } = useChatFilterStore();
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  useDragScroll(scrollRef);

  const onArchive = async (chat: ChatItem) => {
    try {
      if (chat.isArchived) {
        await axios.delete(`/api/archive?chatId=${chat.id}`);
      } else {
        await axios.post("/api/archive", { chatId: chat.id });
      }
      startTransition(() => {
        router.refresh();
      });
    } catch (e) {
      console.error(e);
    }
  };

  const onPin = async (chat: ChatItem) => {
    try {
      if (chat.isPinned) {
        await axios.delete(`/api/pin?chatId=${chat.id}`);
      } else {
        await axios.post("/api/pin", { chatId: chat.id });
      }
      startTransition(() => {
        router.refresh();
      });
    } catch (e) {
      console.error(e);
    }
  };

  const onEdit = (chat: ChatItem) => {
    // For now, let's just log it or pass it. We need the actual server/community objects ideally,
    // but the modal usually fetches or accepts the object.
    // DMs can't be edited. Groups use editServer.
    if (chat.type === "GROUP") {
       // We only have the ID, we might need to fetch the server, or the modal should handle ID
       // Let's assume editServer takes serverId if server is not passed, but useModal takes { server }
       // Since we don't have the full server here, we might just pass { server: { id: chat.serverId } }
       onOpen("editServer", { server: { id: chat.serverId, name: chat.name, imageUrl: chat.imageUrl } as any });
    } else if (chat.type === "COMMUNITY") {
       onOpen("editCommunity", { community: { id: chat.id, name: chat.name, imageUrl: chat.imageUrl } as any });
    } else if (chat.type === "CHANNEL") {
       onOpen("editBroadcastChannel", { broadcastChannel: { id: chat.id, name: chat.name, imageUrl: chat.imageUrl } as any });
    }
  };

  const onDelete = (chat: ChatItem) => {
    if (chat.type === "GROUP") {
       onOpen("deleteServer", { server: { id: chat.serverId, name: chat.name } as any });
    } else if (chat.type === "COMMUNITY") {
       onOpen("deleteCommunity", { community: { id: chat.id, name: chat.name } as any });
    } else if (chat.type === "CHANNEL") {
       onOpen("deleteBroadcastChannel", { broadcastChannel: { id: chat.id, name: chat.name } as any });
    }
  };

  const onCall = (chat: ChatItem, video = false) => {
    if (chat.type === "DM") {
      router.push(`/servers/${chat.serverId}/conversations/${chat.id}?${video ? 'video=true' : 'audio=true'}`);
    } else if (chat.type === "GROUP") {
      router.push(`/servers/${chat.serverId}/channels/${chat.id}?${video ? 'video=true' : 'audio=true'}`);
    }
  };

  useEffect(() => {
    if (!socket) return;

    const onAny = (eventName: string) => {
      if (!eventName.match(/^chat:.+:messages$/)) return;
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        startTransition(() => {
          router.refresh();
        });
      }, 250);
    };

    socket.onAny(onAny);
    return () => {
      socket.offAny(onAny);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [router, socket]);

  const onClick = (chat: ChatItem) => {
    if (chat.type === "DM") {
      router.push(`/servers/${chat.serverId}/conversations/${chat.id}`);
    } else if (chat.type === "GROUP") {
      router.push(`/servers/${chat.serverId}/channels/${chat.id}`);
    } else if (chat.type === "COMMUNITY") {
      router.push(`/communities/${chat.id}`);
    } else if (chat.type === "CHANNEL") {
      router.push(`/broadcasts/${chat.id}`);
    }
  };

  const isActive = (chat: ChatItem) => {
    if (chat.type === "DM") return params?.memberId === chat.id;
    if (chat.type === "GROUP") return params?.channelId === chat.id;
    if (chat.type === "COMMUNITY") return params?.communityId === chat.id;
    if (chat.type === "CHANNEL") return params?.broadcastId === chat.id;
    return false;
  };

  const filteredChats = chats.filter((chat) => {
    // 1. Search term filter
    const term = searchTerm.toLowerCase();
    const matchesSearch = chat.name.toLowerCase().includes(term) || (chat.channelName && chat.channelName.toLowerCase().includes(term));
    if (!matchesSearch) return false;

    // 2. Tab filter
    if (activeTab === "Archived") return chat.isArchived;

    // Hide archived chats from all other tabs
    if (chat.isArchived) return false;

    if (activeTab === "All") return true;
    if (activeTab === "Groups") return chat.type === "GROUP";
    if (activeTab === "Unread") return false; // Not implemented yet
    if (activeTab === "Communities") return chat.type === "COMMUNITY";
    if (activeTab === "Channels") return chat.type === "CHANNEL";

    return true;
  });

  const TabButton = ({ label }: { label: typeof activeTab }) => {
    const isActiveTab = activeTab === label;
    return (
      <button
        onClick={() => setActiveTab(label)}
        className={cn(
          "min-h-8 shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold transition touch-manipulation",
          isActiveTab
            ? "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
            : "bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300"
        )}
      >
        {label === "Communities" ? "Community" : label}
      </button>
    );
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full overflow-hidden">
      <div className="shrink-0 px-3 py-2 space-y-3">
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-zinc-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search or start new chat"
            className="w-full bg-zinc-200 dark:bg-[#1e1f22] text-sm text-black dark:text-zinc-200 rounded-md pl-8 pr-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 placeholder:text-zinc-500 transition-all"
          />
        </div>
        <div className="touch-scroll-x flex items-center gap-x-1.5 overflow-x-auto pb-1 pr-1 scrollbar-none">
          <TabButton label="All" />
          <TabButton label="Unread" />
          <TabButton label="Groups" />
          <TabButton label="Communities" />
          <TabButton label="Channels" />
          <TabButton label="Archived" />
        </div>
      </div>
      <div
        ref={scrollRef}
        tabIndex={0}
        className="touch-scroll flex-1 min-h-0 w-full overflow-y-auto"
      >
      <div className="flex flex-col gap-y-[2px] p-2 pb-4">
        {filteredChats.map((chat) => (
          <ContextMenu key={chat.id + chat.type}>
            <ContextMenuTrigger asChild>
              <div
                role="button"
                tabIndex={0}
                onClick={() => onClick(chat)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onClick(chat);
                  }
                }}
                className={cn(
                  "group flex items-center gap-x-3 w-full p-2 rounded-md hover:bg-zinc-700/10 dark:hover:bg-zinc-700/50 transition cursor-pointer",
                  isActive(chat) && "bg-zinc-700/20 dark:bg-zinc-700"
                )}
              >
            {chat.type === "COMMUNITY" ? (
              <div className="h-10 w-10 md:h-12 md:w-12 shrink-0 bg-indigo-100 dark:bg-indigo-900/50 rounded-xl flex items-center justify-center overflow-hidden">
                {chat.imageUrl ? (
                  <img src={chat.imageUrl} alt={chat.name} className="h-full w-full object-cover" />
                ) : (
                  <Users className="h-1/2 w-1/2 text-indigo-500" />
                )}
              </div>
            ) : chat.communityId ? (
              <div className="relative h-10 w-10 md:h-12 md:w-12 shrink-0">
                {/* Background Community Squircle */}
                <div className="absolute inset-0 bg-indigo-100 dark:bg-indigo-900/50 rounded-xl flex items-center justify-center overflow-hidden">
                  {chat.communityImageUrl ? (
                    <img src={chat.communityImageUrl} alt="Community" className="h-full w-full object-cover opacity-80" />
                  ) : (
                    <Users className="h-1/2 w-1/2 text-indigo-500/80" />
                  )}
                </div>
                {/* Foreground Group/Channel Circle (Bottom Right Overlap) */}
                <div className="absolute -bottom-1 -right-1 h-6 w-6 md:h-7 md:w-7 bg-zinc-100 dark:bg-[#1e1f22] rounded-full flex items-center justify-center p-[2px]">
                  {chat.type === "CHANNEL" ? (
                    <div className="h-full w-full bg-emerald-100 dark:bg-emerald-900/80 rounded-full flex items-center justify-center overflow-hidden">
                       <Megaphone className="h-3.5 w-3.5 md:h-4 md:w-4 text-emerald-500" />
                    </div>
                  ) : (
                    <div className="h-full w-full bg-zinc-200 dark:bg-zinc-700 rounded-full flex items-center justify-center overflow-hidden">
                      {chat.imageUrl ? (
                        <img src={chat.imageUrl} alt={chat.name} className="h-full w-full object-cover" />
                      ) : (
                        <Users className="h-3.5 w-3.5 md:h-4 md:w-4 text-zinc-500" />
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : chat.type === "CHANNEL" ? (
              <div className="h-10 w-10 md:h-12 md:w-12 shrink-0 bg-emerald-100 dark:bg-emerald-900/50 rounded-full flex items-center justify-center overflow-hidden">
                {chat.imageUrl ? (
                  <img src={chat.imageUrl} alt={chat.name} className="h-full w-full object-cover" />
                ) : (
                  <Megaphone className="h-1/2 w-1/2 text-emerald-500" />
                )}
              </div>
            ) : chat.type === "GROUP" ? (
              <div className="h-10 w-10 md:h-12 md:w-12 shrink-0 bg-zinc-200 dark:bg-zinc-800 rounded-full flex items-center justify-center overflow-hidden">
                {chat.imageUrl ? (
                  <img src={chat.imageUrl} alt={chat.name} className="h-full w-full object-cover" />
                ) : (
                  <Users className="h-1/2 w-1/2 text-zinc-500" />
                )}
              </div>
            ) : (
              <UserAvatar
                src={chat.imageUrl}
                className="h-10 w-10 md:h-12 md:w-12"
                status={chat.profileId ? (onlineUsers.some((u: any) => u.userId === chat.profileId) ? "online" : "offline") : undefined}
              />
            )}

            <div className="flex flex-col items-start overflow-hidden w-full">
              <div className="flex items-center justify-between w-full">
                <p
                  className={cn(
                    "font-semibold text-[15px] truncate text-zinc-700 dark:text-zinc-200 group-hover:text-zinc-900 dark:group-hover:text-white transition flex items-center gap-x-1",
                    isActive(chat) && "text-primary dark:text-white"
                  )}
                >
                  {chat.isLocked && <Lock className="h-3.5 w-3.5 text-indigo-500 flex-shrink-0" />}
                  {chat.isMuted && <BellOff className="h-3.5 w-3.5 text-zinc-400 flex-shrink-0" />}
                  {chat.name}
                  {chat.type === "GROUP" && chat.channelName !== "general" && (
                     <span className="text-xs text-zinc-500 ml-1">({chat.channelName})</span>
                  )}
                </p>
                <div className="flex items-center gap-x-1.5 shrink-0 ml-2 justify-end">
                  {chat.isPinned && (
                    <Pin
                      className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400 fill-amber-500/25 dark:fill-amber-400/25 shrink-0 group-hover:hidden"
                      aria-label="Pinned"
                    />
                  )}
                  <div className="relative flex items-center justify-end min-w-[2.25rem]">
                    {chat.lastMessageTimeLabel && (
                      <span className="text-[11px] text-zinc-500 dark:text-zinc-400 group-hover:invisible">
                        {chat.lastMessageTimeLabel}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPin(chat);
                      }}
                      className="absolute right-0 p-0.5 rounded-md opacity-0 group-hover:opacity-100 transition hover:bg-zinc-200 dark:hover:bg-zinc-700"
                      aria-label={chat.isPinned ? "Unpin chat" : "Pin chat"}
                    >
                      {chat.isPinned ? (
                        <PinOff className="h-4 w-4 text-amber-500 dark:text-amber-400" />
                      ) : (
                        <Pin className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <p className="text-[13px] text-zinc-500 dark:text-zinc-400 truncate w-full text-left mt-[2px] flex items-center gap-x-1">
                {chat.amILastSender && chat.lastMessageStatus === "READ" && (
                  <CheckCheck className="h-4 w-4 text-blue-500 shrink-0" />
                )}
                {chat.amILastSender && chat.lastMessageStatus === "DELIVERED" && (
                  <CheckCheck className="h-4 w-4 text-zinc-500 shrink-0" />
                )}
                {chat.amILastSender && chat.lastMessageStatus === "SENT" && (
                  <Check className="h-4 w-4 text-zinc-500 shrink-0" />
                )}
                <span className="truncate">
                  {chat.lastMessage || (chat.type === "DM" ? "Click to chat" : "New group")}
                </span>
              </p>
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          <ContextMenuItem onClick={() => onCall(chat)}>
            <Phone className="w-4 h-4 mr-2" />
            Call
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onCall(chat, true)}>
            <Video className="w-4 h-4 mr-2" />
            Video Call
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onClick(chat)}>
            <MessageSquare className="w-4 h-4 mr-2" />
            Message
          </ContextMenuItem>

          <ContextMenuSeparator />

          {chat.type !== "DM" && (
            <ContextMenuItem onClick={() => onEdit(chat)}>
              <Edit className="w-4 h-4 mr-2" />
              Edit Name
            </ContextMenuItem>
          )}

          <ContextMenuItem onClick={() => onPin(chat)}>
            {chat.isPinned ? <PinOff className="w-4 h-4 mr-2" /> : <Pin className="w-4 h-4 mr-2" />}
            {chat.isPinned ? "Unpin Chat" : "Pin Chat"}
          </ContextMenuItem>

          <ContextMenuItem onClick={() => onArchive(chat)}>
            {chat.isArchived ? <ArchiveRestore className="w-4 h-4 mr-2" /> : <Archive className="w-4 h-4 mr-2" />}
            {chat.isArchived ? "Unarchive Chat" : "Archive Chat"}
          </ContextMenuItem>

          {chat.type !== "DM" && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => onDelete(chat)} className="text-red-600 focus:text-red-600 focus:bg-red-100 dark:focus:bg-red-900/50">
                <Trash className="w-4 h-4 mr-2" />
                Delete
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
        ))}
        {filteredChats.length === 0 && searchTerm && (
          <div className="flex flex-col items-center justify-center pt-10 text-zinc-500 text-sm">
            <p>No chats found for &quot;{searchTerm}&quot;</p>
          </div>
        )}
      </div>
    </div>
    </div>
  );
}
