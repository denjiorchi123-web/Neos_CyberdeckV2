"use client";

import React from "react";
import { BellOff } from "lucide-react";
import { usePreferences } from "@/components/providers/socket-provider";

interface ChatMuteIndicatorProps {
  chatId?: string;
}

export const ChatMuteIndicator = ({ chatId }: ChatMuteIndicatorProps) => {
  const { mutedChats } = usePreferences();
  if (!chatId) return null;

  const isMuted = mutedChats.some((m) => m.chatId === chatId);

  if (!isMuted) return null;

  return <BellOff className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />;
};
