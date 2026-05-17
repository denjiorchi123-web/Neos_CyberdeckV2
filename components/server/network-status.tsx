"use client";

import { Network, Lock, ShieldCheck } from "lucide-react";

export const NetworkStatus = () => {
  return (
    <div className="px-3 py-2 mt-2">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
          Network Mode
        </p>
        <ShieldCheck className="h-3 w-3 text-emerald-500" />
      </div>

      {/* Static LAN-only badge — no toggle, no WiFi option */}
      <div className="flex items-center gap-x-2 p-2 rounded-md bg-emerald-500/10 border border-emerald-500/30">
        <Network className="h-4 w-4 text-emerald-400 shrink-0" />
        <div className="flex flex-col">
          <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">LAN ONLY</span>
          <span className="text-[9px] text-zinc-500">WiFi &amp; Bluetooth disabled</span>
        </div>
        <Lock className="h-3 w-3 text-emerald-600 ml-auto shrink-0" />
      </div>

      <p className="text-[9px] text-zinc-600 mt-1.5 font-mono">
        Air-gapped · fiber only · no internet
      </p>
    </div>
  );
};
