"use client";

import React from "react";
import { MessageSquare } from "lucide-react";
import { useRouter, useParams } from "next/navigation";

import { ActionTooltip } from "@/components/action-tooltip";
import { cn } from "@/lib/utils";

export function NavigationHome() {
  const router = useRouter();
  const params = useParams();

  const onClick = () => {
    router.push("/me");
  };

  return (
    <div>
      <ActionTooltip side="right" align="center" label="Direct Messages">
        <button
          onClick={onClick}
          className="group flex items-center"
        >
          <div className={cn(
            "flex mx-3 h-[48px] w-[48px] rounded-[24px] group-hover:rounded-[16px] transition-all overflow-hidden items-center justify-center bg-background dark:bg-neutral-700 group-hover:bg-indigo-500",
            !params?.serverId && "bg-indigo-500 text-white rounded-[16px]"
          )}>
            <MessageSquare
              className={cn(
                "group-hover:text-white transition text-indigo-500",
                !params?.serverId && "text-white"
              )}
              size={25}
            />
          </div>
        </button>
      </ActionTooltip>
    </div>
  );
}
