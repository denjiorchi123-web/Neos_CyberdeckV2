"use client";

// NOTE: CallModal is NOT registered in ModalProvider and is never mounted.
// Incoming calls are handled by CallProvider + IncomingCallOverlay (app/layout.tsx).
// This file is kept only as a reference — do not re-enable it without removing
// CallProvider's duplicate call:start listener first.

import React, { useEffect, useState, useRef } from "react";
import { Phone, PhoneOff, Video } from "lucide-react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { useSocket } from "@/components/providers/socket-provider";
import { cn } from "@/lib/utils";
import { IncomingRingtone } from "@/lib/audio-tones";

export function CallModal() {
  const { socket } = useSocket();
  const router = useRouter();
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);
  const timeoutRef = useRef<any>(null);
  const shouldPlayRef = useRef(false);
  const endedCallIdsRef = useRef<Set<string>>(new Set());
  const [incomingCall, setIncomingCall] = useState<{
    chatId: string;
    callId: string;
    callerName: string;
    callerUserId?: string;
    type: string;
  } | null>(null);

  // Mark a callId as ended so a late-arriving call:start can't re-ring; auto-expire so
  // the set doesn't grow unboundedly.
  const markCallEnded = (id: string | undefined) => {
    if (!id) return;
    endedCallIdsRef.current.add(id);
    setTimeout(() => endedCallIdsRef.current.delete(id), 60000);
  };

  useEffect(() => {
    if (!socket) return;

    socket.on("call:start", (data: any) => {
      console.log("[CallModal] Received call:start", data);
      
      // RACE CONDITION CHECK: If we already received an 'end' for this specific call attempt, ignore the start.
      if (data.callId && endedCallIdsRef.current.has(data.callId)) {
        console.log("[CallModal] Ignoring call:start because callId is already marked as ended:", data.callId);
        return;
      }

      setIncomingCall(data);
      shouldPlayRef.current = true;
      
      // Play a ringtone. Use a LOCAL asset — this device runs on an air-gapped LAN and
      // a CDN URL would fail silently with no audible ring at all.
      try {
        if (!ringtoneRef.current) {
          ringtoneRef.current = new Audio("/sounds/ringtone.mp3");
          ringtoneRef.current.loop = true;
        }
        
        const playPromise = ringtoneRef.current.play();
        if (playPromise !== undefined) {
          playPromise.then(() => {
            if (!shouldPlayRef.current && ringtoneRef.current) {
              ringtoneRef.current.pause();
              ringtoneRef.current.currentTime = 0;
            }
          }).catch(error => {
            console.error("[CallModal] Audio play error:", error);
          });
        }
      } catch (e) {
        console.error("[CallModal] Ringtone setup error:", e);
      }

      // Auto-missed call after 45 seconds
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        setIncomingCall(prev => {
          if (prev && prev.callId === data.callId) {
            // Register the missed callId so a duplicated/retransmitted call:start
            // (e.g. a mesh redelivery via the Redis adapter) can't re-ring.
            markCallEnded(data.callId);
            shouldPlayRef.current = false;
            stopRingtone();
            return null;
          }
          return prev;
        });
      }, 45000);
    });

    socket.on("call:end", (data: any) => {
      console.log("[CallModal] Received call:end", data);
      const incomingCallId = data?.callId;

      // Record this callId as ended to prevent late-arriving start signals from ringing
      markCallEnded(incomingCallId);

      // Match STRICTLY by callId. The previous chatId fallback could close a brand-new
      // call attempt in the same conversation if a fail-safe broadcast for the previous
      // (already-ended) call arrived after the new call:start.
      setIncomingCall(prev => {
        if (prev && incomingCallId && prev.callId === incomingCallId) {
          shouldPlayRef.current = false;
          stopRingtone();
          return null;
        }
        return prev;
      });
    });

    socket.on("call:decline", (data: any) => {
      console.log("[CallModal] Received call:decline", data);
      const incomingCallId = data?.callId;
      markCallEnded(incomingCallId);
      setIncomingCall(prev => {
        if (prev && incomingCallId && prev.callId === incomingCallId) {
          shouldPlayRef.current = false;
          stopRingtone();
          return null;
        }
        return prev;
      });
    });

    return () => {
      socket.off("call:start");
      socket.off("call:end");
      socket.off("call:decline");
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [socket]);

  const stopRingtone = () => {
    console.log("[CallModal] Stopping ringtone");
    shouldPlayRef.current = false;
    if (ringtoneRef.current) {
      ringtoneRef.current.pause();
      ringtoneRef.current.currentTime = 0;
    }
  };

  const sendCallLogMessage = async (chatId: string, type: string, status: "Missed" | "Declined") => {
    try {
      const callType = type === "video" ? "Video" : "Voice";
      await axios.post(`/api/socket/direct-messages?conversationId=${chatId}`, {
        content: `📞 ${callType} call ${status.toLowerCase()}`,
      });
    } catch (e) {
      console.error("Failed to send call log message", e);
    }
  };

  const onAccept = () => {
    if (incomingCall) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      // Register before navigating so a retransmitted call:start can't re-ring us mid-transition.
      markCallEnded(incomingCall.callId);
      if (socket) {
        socket.emit("call:accept", {
          chatId: incomingCall.chatId,
          callId: incomingCall.callId,
          targetUserId: incomingCall.callerUserId,
        });
      }
      stopRingtone();
      // Redirect to the conversation with video active
      const { serverId, callerMemberId } = incomingCall as any;

      if (serverId && callerMemberId) {
        const queryParam = isVideoCall ? "video=true" : "audio=true";
        router.push(`/servers/${serverId}/conversations/${callerMemberId}?${queryParam}`);
      }

      setIncomingCall(null);
    }
  };

  const onDecline = () => {
    if (incomingCall) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      markCallEnded(incomingCall.callId);
      if (socket) {
        socket.emit("call:decline", {
          chatId: incomingCall.chatId,
          callId: incomingCall.callId,
          targetUserId: incomingCall.callerUserId,
        });
      }
      stopRingtone();
      sendCallLogMessage(incomingCall.chatId, incomingCall.type, "Declined");
      setIncomingCall(null);
    }
  };

  if (!incomingCall) return <div className="hidden" aria-hidden="true" />;

  const isVideoCall = incomingCall.type === "video";
  const CallIcon = isVideoCall ? Video : Phone;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-between bg-black/80 backdrop-blur-2xl animate-in fade-in duration-1000 zoom-in-110">
      
      {/* Top spacer */}
      <div className="flex-1" />

      {/* Center content */}
      <div className="flex flex-col items-center justify-center space-y-8">
        {/* Avatar with pulsing rings */}
        <div className="relative flex items-center justify-center">
          {/* Pulsing rings */}
          <div className="absolute inset-0 h-48 w-48 -m-12 rounded-full border-2 border-indigo-500/50 animate-[ping_3s_cubic-bezier(0,0,0.2,1)_infinite]" />
          <div className="absolute inset-0 h-48 w-48 -m-12 rounded-full border border-indigo-400/30 animate-[ping_4s_cubic-bezier(0,0,0.2,1)_infinite_1s]" />
          <div className="absolute inset-0 h-48 w-48 -m-12 rounded-full bg-indigo-500/10 animate-pulse duration-1000" />
          
          {/* Avatar itself */}
          <div className="relative z-10 h-32 w-32 rounded-full bg-zinc-800 border-4 border-indigo-500 shadow-[0_0_40px_rgba(99,102,241,0.6)] flex items-center justify-center overflow-hidden">
            <span className="text-4xl font-black text-white uppercase">
              {incomingCall.callerName?.charAt(0) || "?"}
            </span>
          </div>
        </div>

        {/* Text info */}
        <div className="flex flex-col items-center space-y-2 text-center mt-8">
          <h1 className="text-4xl font-black text-white tracking-tight drop-shadow-md">
            {incomingCall.callerName || "UNKNOWN CALLER"}
          </h1>
          <p className="text-emerald-500 text-sm font-mono uppercase tracking-[0.3em] font-medium animate-pulse">
            {isVideoCall ? "VIDEO CALL" : "VOICE CALL"}
          </p>
        </div>
      </div>

      {/* Bottom controls */}
      <div className="flex-1 flex items-end justify-center pb-24 w-full">
        <div className="flex items-center justify-center gap-x-24">
          {/* Decline Button */}
          <button 
            onClick={onDecline}
            className="group flex flex-col items-center gap-y-4"
          >
            <div className="h-20 w-20 rounded-full bg-rose-500 hover:bg-rose-600 flex items-center justify-center transition-all duration-300 hover:scale-110 shadow-[0_0_30px_rgba(244,63,94,0.4)] hover:shadow-[0_0_50px_rgba(244,63,94,0.6)] active:scale-95">
              <PhoneOff className="h-8 w-8 text-white rotate-[135deg]" />
            </div>
            <span className="text-xs font-mono text-zinc-400 group-hover:text-rose-400 transition-colors uppercase tracking-widest">Decline</span>
          </button>
          
          {/* Accept Button */}
          <button 
            onClick={onAccept}
            className="group flex flex-col items-center gap-y-4"
          >
            <div className="h-20 w-20 rounded-full bg-emerald-500 hover:bg-emerald-600 flex items-center justify-center transition-all duration-300 hover:scale-110 shadow-[0_0_30px_rgba(16,185,129,0.4)] hover:shadow-[0_0_50px_rgba(16,185,129,0.6)] active:scale-95 animate-bounce [animation-duration:2s]">
              <CallIcon className="h-8 w-8 text-white" />
            </div>
            <span className="text-xs font-mono text-zinc-400 group-hover:text-emerald-400 transition-colors uppercase tracking-widest">Accept</span>
          </button>
        </div>
      </div>
      
    </div>
  );
}
