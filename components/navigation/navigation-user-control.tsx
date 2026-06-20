"use client";

import React, { useState } from "react";
import { LogOut, UserCircle2, Loader2, Power } from "lucide-react";
import { useRouter } from "next/navigation";

import { ModeToggle } from "@/components/mode-toggle";
import { ActionTooltip } from "@/components/action-tooltip";

interface NavigationUserControlProps {
  userName: string;
}

export function NavigationUserControl({ userName }: NavigationUserControlProps) {
  const router = useRouter();
  const [isPoweringOff, setIsPoweringOff] = useState(false);

  const onPowerOff = async () => {
    if (isPoweringOff) return;
    setIsPoweringOff(true);

    try {
      await fetch("/api/system/quit", { method: "POST" });
    } catch {
      setIsPoweringOff(false);
    }
  };

  return (
    <div className="shrink-0 w-full border-t border-zinc-300/80 dark:border-zinc-700/80 bg-[#e3e5e8] dark:bg-[#1e1f22] py-2 flex items-center flex-col gap-y-3">
      <ModeToggle />

      <ActionTooltip side="right" align="center" label={`Profile: ${userName}`}>
        <button
          onClick={() => router.push("/profile")}
          className="group relative flex h-9 w-9 items-center justify-center rounded-[18px] hover:rounded-[12px] transition-all overflow-hidden bg-background dark:bg-zinc-700 hover:bg-indigo-500/20 text-zinc-500 hover:text-indigo-400"
        >
          <UserCircle2 size={18} />
        </button>
      </ActionTooltip>

      <div className="w-10 h-[2px] bg-zinc-300 dark:bg-zinc-700 rounded-md mx-auto" />

      <ActionTooltip side="right" align="center" label="Exit CyberDeck OS">
        <button
          onClick={onPowerOff}
          disabled={isPoweringOff}
          className="group relative flex h-10 w-10 items-center justify-center rounded-[20px] hover:rounded-[16px] transition-all overflow-hidden bg-rose-500/10 hover:bg-rose-500 text-rose-500 hover:text-white mb-2"
        >
          {isPoweringOff ? <Loader2 className="animate-spin" size={20} /> : <Power size={20} />}
        </button>
      </ActionTooltip>
    </div>
  );
}
