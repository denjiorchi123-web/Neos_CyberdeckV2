"use client";

import React, { Fragment, useRef, ElementRef, useEffect } from "react";
import { Member, Message, Profile } from "@prisma/client";
import { Loader2, ServerCrash } from "lucide-react";
import { format } from "date-fns";

import { ChatWelcome } from "@/components/chat/chat-welcome";
import { ChatItem } from "@/components/chat/chat-item";
import { useChatQuery } from "@/hooks/use-chat-query";
import { useChatSocket } from "@/hooks/use-chat-socket";
import { useChatScroll } from "@/hooks/use-chat-scroll";
import { useChatRead } from "@/hooks/use-chat-read";
import { useSocket } from "@/components/providers/socket-provider";

interface ChatMessagesProps {
  name: string;
  member: Member;
  chatId: string;
  apiUrl: string;
  socketUrl: string;
  socketQuery: Record<string, string>;
  paramKey: "channelId" | "conversationId" | "broadcastId";
  paramValue: string;
  type: "channel" | "conversation" | "broadcast";
}

type MessagesWithMemberWithProfile = Message & {
  member: Member & {
    profile: Profile;
  };
};

const DATE_FORMAT = "d MMM yyyy, HH:mm";

export function ChatMessages({
  name,
  member,
  chatId,
  apiUrl,
  socketUrl,
  socketQuery,
  paramKey,
  paramValue,
  type
}: ChatMessagesProps) {
  const queryKey = `chat:${chatId}`;
  const addKey = `chat:${chatId}:messages`;
  const updateKey = `chat:${chatId}:messages:update`;

  const { socket } = useSocket();
  const chatRef = useRef<ElementRef<"div">>(null);
  const bottomRef = useRef<ElementRef<"div">>(null);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, status } =
    useChatQuery({
      queryKey,
      apiUrl,
      paramKey,
      paramValue
    });
  useChatSocket({
    queryKey,
    addKey,
    updateKey
  });
  useChatRead({
    chatId,
    apiUrl: "/api/socket/direct-messages",
    isEnabled: type === "conversation"
  });
  // Automatically send 'READ' status when messages are loaded and visible
  useEffect(() => {
    if (!socket || !data?.pages?.[0]?.items?.length) return;

    const unreadMessageIds = data.pages
      .flatMap(page => page.items)
      .filter(item => item.memberId !== member.id && item.status !== "READ")
      .map(item => item.id);

    if (unreadMessageIds.length > 0) {
      socket.emit("message:read", {
        messageIds: unreadMessageIds,
        type: type === "channel" ? "channel" : (type === "broadcast" ? "broadcast" : "direct"),
        chatId: chatId
      });
    }
  }, [data, socket, member.id, type, chatId]);

  useChatScroll({
    chatRef,
    bottomRef,
    loadMore: fetchNextPage,
    shouldLoadMore: !isFetchingNextPage && !!hasNextPage,
    count: data?.pages?.[0]?.items?.length ?? 0
  });

  if (status === "loading")
    return (
      <div className="flex flex-col flex-1 justify-center items-center">
        <Loader2 className="h-7 w-7 text-zinc-500 animate-spin my-4" />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Loading messages...
        </p>
      </div>
    );

  if (status === "error")
    return (
      <div className="flex flex-col flex-1 justify-center items-center">
        <ServerCrash className="h-7 w-7 text-zinc-500 my-4" />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Something went wrong!
        </p>
      </div>
    );

  return (
    <div
      ref={chatRef}
      className="flex-1 flex flex-col-reverse py-4 overflow-y-auto"
    >
      <div ref={bottomRef} />
      {data?.pages.map((group, index) => (
        <Fragment key={index}>
          {group?.items.map((message: MessagesWithMemberWithProfile) => (
            <ChatItem
              key={message.id}
              currentMember={member}
              member={message.member}
              id={message.id}
              content={message.content}
              fileUrl={message.fileUrl}
              fileName={(message as any).fileName}
              fileSize={(message as any).fileSize}
              mimeType={(message as any).mimeType}
              thumbnailUrl={(message as any).thumbnailUrl}
              mediaKey={(message as any).mediaKey}
              type={message.type}
              deleted={message.deleted}
              timestamp={format(
                new Date(message.createdAt),
                DATE_FORMAT
              )}
              isUpdated={message.updatedAt !== message.createdAt}
              socketQuery={socketQuery}
              socketUrl={socketUrl}
              status={(message as any).status}
              replyTo={(message as any).replyTo}
              isPinned={(message as any).isPinned}
            />
          ))}
        </Fragment>
      ))}
      {hasNextPage && (
        <div className="flex justify-center">
          {isFetchingNextPage ? (
            <Loader2 className="h-6 w-6 text-zinc-500 animate-spin my-4" />
          ) : (
            <button
              onClick={() => fetchNextPage()}
              className="text-zinc-500 hover:text-zinc-600 dark:text-zinc-400 text-xs my-4 dark:hover:text-zinc-300 transition"
            >
              Load previous messages
            </button>
          )}
        </div>
      )}
      {!hasNextPage && <ChatWelcome name={name} type={type} />}
    </div>
  );
}
