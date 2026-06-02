"use client";

import React from "react";
import { Globe } from "lucide-react";
import { useRouter } from "next/navigation";

import { ActionTooltip } from "@/components/action-tooltip";

export function NavigationLauncher() {
  const router = useRouter();

  return (
    <div>
      <ActionTooltip side="right" align="center" label="Mesh Launcher (Select Node)">
        <button
          onClick={() => router.push("/launcher")}
          className="group flex shrink-0 items-center"
        >
          <div className="flex shrink-0 mx-3 h-[48px] w-[48px] rounded-[24px] group-hover:rounded-[16px] transition-all overflow-hidden items-center justify-center bg-indigo-600 group-hover:bg-indigo-500 shadow-lg shadow-indigo-900/50">
            <Globe className="text-white group-hover:text-white transition" size={25} />
          </div>
        </button>
      </ActionTooltip>
    </div>
  );
}
