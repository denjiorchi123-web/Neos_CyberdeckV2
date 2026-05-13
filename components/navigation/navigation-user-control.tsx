"use client";

import React from "react";
import { LogOut, User } from "lucide-react";
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
      <ActionTooltip side="right" align="center" label={`Logged in as ${userName}`}>
        <div className="p-2 text-zinc-500 cursor-default">
           <User size={20} />
        </div>
      </ActionTooltip>
      <ActionTooltip side="right" align="center" label="Logout">
        <button
          onClick={onLogout}
          className="group relative flex items-center p-3 rounded-[24px] group-hover:rounded-[16px] transition-all overflow-hidden items-center justify-center bg-background dark:bg-zinc-700 hover:bg-rose-500/20 text-rose-500"
        >
          <LogOut size={20} />
        </button>
      </ActionTooltip>
    </div>
  );
}
