"use client";

import { Settings, Users, Trash } from "lucide-react";
import { useModal } from "@/hooks/use-modal-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";

export const CommunityHeaderAction = ({ community }: { community: any }) => {
  const { onOpen } = useModal();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-700/50 rounded-md transition outline-none">
          <Settings className="h-5 w-5 text-zinc-500" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 text-xs font-medium text-black dark:text-neutral-400 space-y-[2px]">
        <DropdownMenuItem
          onClick={() => onOpen("communityMembers", { community })}
          className="px-3 py-2 text-sm cursor-pointer"
        >
          Manage Members
          <Users className="h-4 w-4 ml-auto" />
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => onOpen("deleteCommunity", { community })}
          className="text-rose-500 px-3 py-2 text-sm cursor-pointer"
        >
          Delete Community
          <Trash className="h-4 w-4 ml-auto" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
