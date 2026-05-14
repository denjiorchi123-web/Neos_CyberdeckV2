"use client";

import { useSocket } from "@/components/providers/socket-provider";

interface ChatHeaderStatusProps {
  otherMemberId?: string;
}

export const ChatHeaderStatus = ({ otherMemberId }: ChatHeaderStatusProps) => {
  const { onlineUsers } = useSocket();
  const isOnline = otherMemberId ? onlineUsers.some((u: any) => u.userId === otherMemberId) : false;

  if (!isOnline) return null;

  return (
    <p className="text-[10px] text-emerald-500 font-bold animate-pulse">
      Online
    </p>
  );
};
