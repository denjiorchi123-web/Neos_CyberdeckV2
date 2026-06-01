"use client";

import { useCall } from "@/hooks/use-call";
import { Phone, PhoneOff, Video, Loader2, Lock } from "lucide-react";
import { usePreferences } from "@/components/providers/socket-provider";

export const IncomingCallOverlay = () => {
  const { status, callType, remotePeer, chatId, acceptCall, declineCall } = useCall();
  const { lockedChats } = usePreferences();

  if (status !== "RINGING") return null;

  const isVideo = callType === "video";
  const CallIcon = isVideo ? Video : Phone;
  const initial = remotePeer?.name?.charAt(0)?.toUpperCase() || "?";

  // Informational only — the call itself can be answered freely.
  // PIN will be required when the user returns to the chat screen after the call.
  const isLocked = chatId ? lockedChats.some((lc: any) => lc.chatId === chatId) : false;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-between overflow-hidden bg-[#0d0f14] animate-in fade-in duration-500">

      {/* Subtle radial glow */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_38%,rgba(99,102,241,0.07)_0%,transparent_70%)] pointer-events-none" />

      {/* Top row */}
      <div className="relative z-10 flex justify-between w-full px-5 pt-5">
        {/* Lock notice — shown when the call is from a locked chat */}
        {isLocked ? (
          <div className="flex items-center gap-x-1.5 bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[10px] font-mono font-bold uppercase tracking-widest px-3 py-1.5 rounded-full">
            <Lock className="h-3 w-3" />
            PIN needed after call
          </div>
        ) : (
          <div /> /* spacer */
        )}

        <div className="flex items-center gap-x-1.5 bg-white/5 border border-white/10 text-emerald-400 text-[10px] font-mono font-bold uppercase tracking-widest px-3 py-1.5 rounded-full">
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          E2E Encrypted
        </div>
      </div>

      {/* Center */}
      <div className="flex-1 flex flex-col items-center justify-center relative z-10 -mt-8">

        {/* Avatar + rings */}
        <div className="relative flex items-center justify-center mb-8">
          {/* Outer glow blob */}
          <div className="absolute w-80 h-80 rounded-full bg-indigo-500/8 blur-3xl" />

          {/* Pulsing rings */}
          <div className="absolute w-72 h-72 rounded-full border border-indigo-500/20 animate-[ping_3s_ease-in-out_infinite]" />
          <div className="absolute w-56 h-56 rounded-full border border-indigo-400/15 animate-[ping_3.7s_ease-in-out_infinite_0.8s]" />
          <div className="absolute w-64 h-64 rounded-full border-2 border-indigo-500/10" />

          {/* Avatar */}
          <div className="relative z-10 h-44 w-44 rounded-full bg-zinc-800 border-4 border-indigo-500/50 shadow-[0_0_60px_rgba(99,102,241,0.4),0_0_100px_rgba(99,102,241,0.15)] flex items-center justify-center overflow-hidden">
            <span className="text-6xl font-black text-white">{initial}</span>
          </div>
        </div>

        {/* Name + call type */}
        <h1 className="text-4xl font-black text-white tracking-tight drop-shadow-md mb-2 text-center">
          {remotePeer?.name || "Unknown"}
        </h1>
        <div className="flex items-center gap-x-2 text-indigo-300 mb-1">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm font-mono uppercase tracking-[0.25em] font-medium">
            Incoming {isVideo ? "Video" : "Voice"} Call
          </span>
        </div>
      </div>

      {/* Bottom controls */}
      <div className="relative z-10 flex items-end justify-center pb-20 w-full">
        <div className="flex items-center justify-center gap-x-20">

          {/* Decline */}
          <button
            onClick={declineCall}
            className="group flex flex-col items-center gap-y-3"
          >
            <div className="h-20 w-20 rounded-full bg-rose-600 hover:bg-rose-500 flex items-center justify-center transition-all duration-300 hover:scale-110 shadow-[0_0_28px_rgba(244,63,94,0.4)] hover:shadow-[0_0_48px_rgba(244,63,94,0.6)] active:scale-95">
              <PhoneOff className="h-8 w-8 text-white rotate-[135deg]" />
            </div>
            <span className="text-[11px] font-mono text-zinc-500 group-hover:text-rose-400 transition-colors uppercase tracking-widest">Decline</span>
          </button>

          {/* Accept — always works, no PIN required */}
          <button
            onClick={acceptCall}
            className="group flex flex-col items-center gap-y-3"
          >
            <div className="h-20 w-20 rounded-full bg-emerald-500 hover:bg-emerald-400 flex items-center justify-center transition-all duration-300 hover:scale-110 shadow-[0_0_28px_rgba(16,185,129,0.4)] hover:shadow-[0_0_48px_rgba(16,185,129,0.6)] active:scale-95 animate-bounce [animation-duration:2s]">
              <CallIcon className="h-8 w-8 text-white" />
            </div>
            <span className="text-[11px] font-mono text-zinc-500 group-hover:text-emerald-400 transition-colors uppercase tracking-widest">Accept</span>
          </button>

        </div>
      </div>
    </div>
  );
};
