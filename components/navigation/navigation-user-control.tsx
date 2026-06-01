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
      <ActionTooltip side="right" align="center" label={isLoggingOut ? "Signing out…" : "Sign out"}>
        <button
          onClick={onLogout}
          disabled={isLoggingOut}
          className="group relative flex items-center justify-center p-3 rounded-[24px] hover:rounded-[16px] transition-all overflow-hidden bg-background dark:bg-zinc-700 hover:bg-rose-500/20 text-rose-500 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isLoggingOut
            ? <Loader2 size={20} className="animate-spin" />
            : <LogOut size={20} />
          }
        </button>
      </ActionTooltip>
    </div>
  );
}
