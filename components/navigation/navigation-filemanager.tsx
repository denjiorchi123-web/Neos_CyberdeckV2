"use client";

import React from "react";
import { FolderOpen } from "lucide-react";
import { useRouter, usePathname } from "next/navigation";
import { ActionTooltip } from "@/components/action-tooltip";
import { cn } from "@/lib/utils";

export function NavigationFileManager() {
  const router   = useRouter();
  const pathname = usePathname();
  const active   = pathname?.startsWith("/filemanager");

  return (
    <ActionTooltip side="right" align="center" label="File Manager">
      <button onClick={() => router.push("/filemanager")} className="group flex shrink-0 items-center">
        <div className={cn(
          "flex shrink-0 mx-3 h-11 w-11 rounded-[22px] group-hover:rounded-[14px] transition-all overflow-hidden items-center justify-center bg-background dark:bg-neutral-700 group-hover:bg-zinc-500",
          active && "bg-zinc-500 text-white rounded-[16px]"
        )}>
          <FolderOpen className={cn(
            "group-hover:text-white transition text-zinc-500",
            active && "text-white"
          )} size={22} />
        </div>
      </button>
    </ActionTooltip>
  );
}
