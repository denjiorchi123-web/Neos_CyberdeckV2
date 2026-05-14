"use client";

import { useState } from "react";
import { Wifi, Network, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

export const NetworkStatus = () => {
  const [mode, setMode] = useState<"wifi" | "lan">("wifi");

  return (
    <div className="px-3 py-2 mt-2">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
          Network Mode
        </p>
        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => setMode("wifi")}
          className={cn(
            "flex-1 flex flex-col items-center justify-center p-2 rounded-md border transition group",
            mode === "wifi" 
              ? "bg-indigo-500/10 border-indigo-500 text-indigo-500" 
              : "bg-transparent border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-700/10"
          )}
        >
          <Wifi className="h-4 w-4 mb-1" />
          <span className="text-[10px] font-bold">WIFI</span>
        </button>
        <button
          onClick={() => setMode("lan")}
          className={cn(
            "flex-1 flex flex-col items-center justify-center p-2 rounded-md border transition group",
            mode === "lan" 
              ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" 
              : "bg-transparent border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-700/10"
          )}
        >
          <Network className="h-4 w-4 mb-1" />
          <span className="text-[10px] font-bold">LAN</span>
        </button>
      </div>
      <p className="text-[9px] text-zinc-500 mt-2 italic">
        * Optimizing for {mode === "wifi" ? "low-latency wireless" : "high-bandwidth cable"}...
      </p>
    </div>
  );
};
