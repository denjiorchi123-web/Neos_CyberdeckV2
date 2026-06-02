"use client";

import React from "react";
import { Terminal } from "lucide-react";
import { useRouter, usePathname } from "next/navigation";
import { ActionTooltip } from "@/components/action-tooltip";
import { cn } from "@/lib/utils";

export function NavigationLogs() {
  const router   = useRouter();
  const pathname = usePathname();
  const active   = pathname?.startsWith("/logs");

  return (
    <ActionTooltip side="right" align="center" label="System Logs">
      <button onClick={() => router.push("/logs")} className="group flex shrink-0 items-center">
        <div className={cn(
          "flex shrink-0 mx-3 h-[48px] w-[48px] rounded-[24px] group-hover:rounded-[16px] transition-all overflow-hidden items-center justify-center bg-background dark:bg-neutral-700 group-hover:bg-zinc-500",
          active && "bg-zinc-500 text-white rounded-[16px]"
        )}>
          <Terminal className={cn(
            "group-hover:text-white transition text-zinc-500",
            active && "text-white"
          )} size={22} />
        </div>
      </button>
    </ActionTooltip>
  );
}
