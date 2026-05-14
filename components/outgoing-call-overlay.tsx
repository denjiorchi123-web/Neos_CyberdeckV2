"use client";

import { useCall } from "@/hooks/use-call";
import { UserAvatar } from "@/components/user-avatar";
import { PhoneOff } from "lucide-react";

export const OutgoingCallOverlay = () => {
  const { status, callType, remotePeer, endCall } = useCall();

  if (status !== "OUTGOING") return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-500">
      <div className="bg-[#1e1f22] p-8 rounded-3xl border border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.5)] flex flex-col items-center max-w-xs w-full">
        <div className="relative mb-6">
          <div className="absolute inset-0 rounded-full bg-indigo-500/20 animate-pulse scale-150" />
          <UserAvatar 
            src={remotePeer?.avatar}
            className="h-24 w-24 md:h-32 md:w-32 border-4 border-indigo-500/50"
          />
        </div>
        
        <h2 className="text-2xl font-bold text-white mb-1">
          {remotePeer?.name || "Connecting..."}
        </h2>
        <p className="text-zinc-400 text-sm font-mono tracking-widest uppercase mb-8">
          Calling ({callType})...
        </p>

        <button
          onClick={endCall}
          className="p-4 bg-rose-500 hover:bg-rose-600 rounded-full text-white transition-all hover:scale-110 active:scale-95 shadow-lg shadow-rose-500/20"
        >
          <PhoneOff className="h-6 w-6" />
        </button>
      </div>
    </div>
  );
};
