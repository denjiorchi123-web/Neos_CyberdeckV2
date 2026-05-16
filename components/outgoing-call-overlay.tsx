"use client";

import { useCall } from "@/hooks/use-call";
import { PhoneOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export const OutgoingCallOverlay = () => {
  const { status, callType, remotePeer, endCall } = useCall();

  if (status !== "OUTGOING") return null;

  const isVideo = callType === "video";
  const initial = remotePeer?.name?.charAt(0)?.toUpperCase() || "?";

  return (
    <div className="fixed inset-0 z-[100] flex flex-col overflow-hidden bg-[#0d0f14] animate-in fade-in duration-500">

      {/* Ambient radial glow */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_38%,rgba(99,102,241,0.06)_0%,transparent_70%)] pointer-events-none" />

      {/* Top row */}
      <div className="relative z-20 flex items-center justify-between px-5 pt-5">
        <div className="w-24" />
        <div className="flex items-center gap-x-1.5 bg-white/5 border border-white/10 text-emerald-400 text-[10px] font-mono font-bold uppercase tracking-widest px-3 py-1.5 rounded-full">
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          E2E Encrypted
        </div>
      </div>

      {/* Center hero */}
      <div className="flex-1 flex flex-col items-center justify-center relative z-10 px-8 -mt-4">

        {/* Avatar + rings */}
        <div className="relative flex items-center justify-center mb-8">
          <div className="absolute w-80 h-80 rounded-full bg-indigo-500/5 blur-3xl" />
          <div className="absolute w-72 h-72 rounded-full border border-indigo-500/15 animate-[ping_3.5s_ease-in-out_infinite]" />
          <div className="absolute w-56 h-56 rounded-full border border-indigo-500/10 animate-[ping_3s_ease-in-out_infinite_0.7s]" />
          <div className="absolute w-64 h-64 rounded-full border-2 border-indigo-500/8" />

          <div className={cn(
            "relative z-10 w-44 h-44 rounded-full overflow-hidden border-4 shadow-2xl",
            "border-white/10 bg-zinc-800"
          )}>
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-6xl font-black text-zinc-300">{initial}</span>
            </div>
          </div>
        </div>

        {/* Name */}
        <h2 className="text-4xl font-bold text-white tracking-tight mb-3 text-center">
          {remotePeer?.name || "Connecting..."}
        </h2>

        {/* Status */}
        <div className="flex items-center gap-x-2 text-zinc-400 mb-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm font-mono uppercase tracking-[0.2em]">
            {isVideo ? "Video" : "Voice"} Calling…
          </span>
        </div>
      </div>

      {/* Bottom end-call button */}
      <div className="relative z-20 flex justify-center px-6 pb-10 pt-4">
        <button
          onClick={endCall}
          aria-label="End call"
          className="h-16 w-16 rounded-full bg-rose-600 hover:bg-rose-500 flex items-center justify-center transition-all duration-300 shadow-[0_0_20px_rgba(244,63,94,0.4)] hover:shadow-[0_0_30px_rgba(244,63,94,0.6)] active:scale-95"
        >
          <PhoneOff className="h-7 w-7 text-white rotate-[135deg]" />
        </button>
      </div>
    </div>
  );
};
