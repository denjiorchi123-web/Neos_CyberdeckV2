"use client";

import React from "react";
import { Plus, MessageSquare, Users, Rss, Hash } from "lucide-react";
import { useModal } from "@/hooks/use-modal-store";
import { ActionTooltip } from "@/components/action-tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export function UnifiedChatHeaderAction() {
  const { onOpen } = useModal();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="focus:outline-none" asChild>
        <button className="group flex items-center justify-center h-8 w-8 rounded-full bg-zinc-200 dark:bg-zinc-800 hover:bg-indigo-500 dark:hover:bg-indigo-500 transition-colors">
          <Plus className="h-5 w-5 text-zinc-600 dark:text-zinc-400 group-hover:text-white transition-colors" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 text-xs font-medium text-black dark:text-neutral-400 space-y-[2px]">
        <DropdownMenuItem 
          onClick={() => onOpen("createServer")}
          className="text-indigo-600 dark:text-indigo-400 px-3 py-2 text-sm cursor-pointer"
        >
          New Chat
          <MessageSquare className="h-4 w-4 ml-auto" />
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem 
          onClick={() => onOpen("createServer")}
          className="px-3 py-2 text-sm cursor-pointer"
        >
          New Group
          <Users className="h-4 w-4 ml-auto" />
        </DropdownMenuItem>
        <DropdownMenuItem 
          onClick={() => onOpen("createCommunity")}
          className="px-3 py-2 text-sm cursor-pointer"
        >
          New Community
          <Hash className="h-4 w-4 ml-auto" />
        </DropdownMenuItem>
        <DropdownMenuItem 
          onClick={() => onOpen("createBroadcastChannel")}
          className="px-3 py-2 text-sm cursor-pointer"
        >
          New Channel
          <Rss className="h-4 w-4 ml-auto" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
