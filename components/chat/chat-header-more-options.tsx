"use client";

import { MoreVertical, Image, BellOff, Trash2, Download, Ban, Lock, Unlock } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useModal } from "@/hooks/use-modal-store";
import { usePreferences } from "@/components/providers/socket-provider";
import axios from "axios";
import { useRouter } from "next/navigation";

interface ChatHeaderMoreOptionsProps {
  chatId?: string;
  type: "channel" | "conversation";
  otherMemberId?: string;
  otherProfileId?: string;
}

export function ChatHeaderMoreOptions({ chatId, type, otherMemberId, otherProfileId }: ChatHeaderMoreOptionsProps) {
  const { onOpen } = useModal();
  const { lockedChats, hasPinEnabled, refreshPreferences } = usePreferences();
  const router = useRouter();
  const isDirect = type === "conversation";
  const isLocked = lockedChats.some(lc => lc.chatId === chatId);

  const handleLockToggle = async () => {
    if (!hasPinEnabled) {
      onOpen("chatPinSetup", { chatId });
      return;
    }
    
    try {
      if (isLocked) {
        onOpen("unlockChatVerify", { chatId });
        return;
      } else {
        await axios.post("/api/locked-chats", { chatId });
        const unlockedChats = JSON.parse(sessionStorage.getItem("unlockedChats") || "[]");
        sessionStorage.setItem("unlockedChats", JSON.stringify(unlockedChats.filter((id: string) => id !== chatId)));
      }
      refreshPreferences();
      router.refresh();
    } catch (error: any) {
      console.error("[LOCK_TOGGLE_ERROR]", error);
      if (error?.response?.status === 400 && error?.response?.data === "PIN not setup") {
        onOpen("chatPinSetup", { chatId });
      }
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="focus:outline-none" asChild>
        <button className="text-zinc-500 hover:text-zinc-600 dark:text-zinc-400 dark:hover:text-zinc-300 transition ml-2">
          <MoreVertical className="h-5 w-5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56 text-xs font-medium text-black dark:text-neutral-400 space-y-[2px]" align="end">
        <DropdownMenuItem onClick={() => onOpen("chatMediaGallery", { chatId, isDirect })} className="px-3 py-2 text-sm cursor-pointer">
          <Image className="h-4 w-4 mr-2" />
          Media, Links, and Docs
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onOpen("muteChat", { chatId, isDirect })} className="px-3 py-2 text-sm cursor-pointer">
          <BellOff className="h-4 w-4 mr-2" />
          Mute Notifications
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onOpen("clearChat", { chatId, isDirect })} className="px-3 py-2 text-sm cursor-pointer">
          <Trash2 className="h-4 w-4 mr-2" />
          Clear Chat
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onOpen("exportChat", { chatId, isDirect })} className="px-3 py-2 text-sm cursor-pointer">
          <Download className="h-4 w-4 mr-2" />
          Export Chat
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLockToggle} className="px-3 py-2 text-sm cursor-pointer text-indigo-500">
          {isLocked ? <Unlock className="h-4 w-4 mr-2" /> : <Lock className="h-4 w-4 mr-2" />}
          {isLocked ? "Unlock Chat" : "Lock Chat"}
        </DropdownMenuItem>
        {isDirect && otherMemberId && (
          <>
            {hasPinEnabled && (
            <DropdownMenuItem
              onClick={() => onOpen("changePin")}
              className="text-indigo-500 hover:bg-indigo-500 hover:text-white cursor-pointer"
            >
              Change PIN
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onOpen("blockUser", { memberId: otherMemberId, memberProfileId: otherProfileId })} className="text-rose-500 px-3 py-2 text-sm cursor-pointer">
              <Ban className="h-4 w-4 mr-2" />
              Block / Unblock
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
