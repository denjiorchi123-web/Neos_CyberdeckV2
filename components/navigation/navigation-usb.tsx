"use client";

import React from "react";
import { Usb } from "lucide-react";
import { useRouter, usePathname } from "next/navigation";
import { ActionTooltip } from "@/components/action-tooltip";
import { cn } from "@/lib/utils";

export function NavigationUsb() {
  const router   = useRouter();
  const pathname = usePathname();
  const active   = pathname?.startsWith("/files");

  return (
    <ActionTooltip side="right" align="center" label="USB File Manager">
      <button onClick={() => router.push("/files")} className="group flex shrink-0 items-center">
        <div className={cn(
          "flex shrink-0 mx-3 h-11 w-11 rounded-[22px] group-hover:rounded-[14px] transition-all overflow-hidden items-center justify-center bg-background dark:bg-neutral-700 group-hover:bg-emerald-500",
          active && "bg-emerald-500 text-white rounded-[16px]"
        )}>
          <Usb className={cn(
            "group-hover:text-white transition text-emerald-500",
            active && "text-white"
          )} size={22} />
        </div>
      </button>
    </ActionTooltip>
  );
}
