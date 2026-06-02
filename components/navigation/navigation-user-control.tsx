"use client";

import React, { useState } from "react";
import { LogOut, UserCircle2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

import { ModeToggle } from "@/components/mode-toggle";
import { ActionTooltip } from "@/components/action-tooltip";

interface NavigationUserControlProps {
  userName: string;
}

export function NavigationUserControl({ userName }: NavigationUserControlProps) {
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const onLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);

    try {
      // Use fetch with a 4-second timeout so it never hangs forever
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);

      await fetch("/api/auth", {
        method: "DELETE",
        signal: controller.signal,
      }).catch(() => {/* ignore — we navigate regardless */});

      clearTimeout(timer);
    } catch {
      // Network error or timeout — still log out locally
    } finally {
      // Always navigate to sign-in regardless of API result
      window.location.assign("/sign-in");
    }
  };

  return (
    <div className="shrink-0 w-full border-t border-zinc-300/80 dark:border-zinc-700/80 bg-[#e3e5e8] dark:bg-[#1e1f22] py-1 flex items-center flex-col gap-y-1">
      <ModeToggle />

      {/* Profile settings button */}
      <ActionTooltip side="right" align="center" label={`Profile: ${userName}`}>
        <button
          onClick={() => router.push("/profile")}
          className="group relative flex h-9 w-9 items-center justify-center rounded-[18px] hover:rounded-[12px] transition-all overflow-hidden bg-background dark:bg-zinc-700 hover:bg-indigo-500/20 text-zinc-500 hover:text-indigo-400"
        >
          <UserCircle2 size={18} />
        </button>
      </ActionTooltip>

      {/* Logout button */}
      <ActionTooltip side="right" align="center" label={isLoggingOut ? "Signing out…" : "Sign out"}>
        <button
          onClick={onLogout}
          disabled={isLoggingOut}
          className="group relative flex h-9 w-9 items-center justify-center rounded-[18px] hover:rounded-[12px] transition-all overflow-hidden bg-background dark:bg-zinc-700 hover:bg-rose-500/20 text-rose-500 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isLoggingOut
            ? <Loader2 size={18} className="animate-spin" />
            : <LogOut size={18} />
          }
        </button>
      </ActionTooltip>
    </div>
  );
}
