"use client";

import React from "react";
import { LogOut, UserCircle2 } from "lucide-react";
import axios from "axios";
import { useRouter } from "next/navigation";

import { ModeToggle } from "@/components/mode-toggle";
import { ActionTooltip } from "@/components/action-tooltip";

interface NavigationUserControlProps {
  userName: string;
}

export function NavigationUserControl({ userName }: NavigationUserControlProps) {
  const router = useRouter();

  const onLogout = async () => {
    try {
      await axios.delete("/api/auth");
      window.location.href = "/sign-in";
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <div className="pb-3 mt-auto flex items-center flex-col gap-y-4">
      <ModeToggle />

      {/* Profile settings button */}
      <ActionTooltip side="right" align="center" label={`Profile: ${userName}`}>
        <button
          onClick={() => router.push("/profile")}
          className="group relative flex items-center justify-center p-3 rounded-[24px] hover:rounded-[16px] transition-all overflow-hidden bg-background dark:bg-zinc-700 hover:bg-indigo-500/20 text-zinc-500 hover:text-indigo-400"
        >
          <UserCircle2 size={20} />
        </button>
      </ActionTooltip>

      {/* Logout button */}
      <ActionTooltip side="right" align="center" label="Sign out">
        <button
          onClick={onLogout}
          className="group relative flex items-center justify-center p-3 rounded-[24px] hover:rounded-[16px] transition-all overflow-hidden bg-background dark:bg-zinc-700 hover:bg-rose-500/20 text-rose-500"
        >
          <LogOut size={20} />
        </button>
      </ActionTooltip>
    </div>
  );
}
