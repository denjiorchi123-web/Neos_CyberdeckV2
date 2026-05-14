"use client";

import React, { useEffect, useState, useRef } from "react";
import { Phone, PhoneOff, Video } from "lucide-react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { useSocket } from "@/components/providers/socket-provider";
import { cn } from "@/lib/utils";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function CallModal() {
  const { socket } = useSocket();
  const router = useRouter();
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);
  const timeoutRef = useRef<any>(null);
  const [incomingCall, setIncomingCall] = useState<{
    chatId: string;
    callerName: string;
    type: string;
  } | null>(null);

  useEffect(() => {
    if (!socket) return;

    socket.on("call:start", (data: any) => {
      setIncomingCall(data);
      
      // Play a ringtone
      try {
        if (!ringtoneRef.current) {
          ringtoneRef.current = new Audio("https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3");
          ringtoneRef.current.loop = true;
        }
        ringtoneRef.current.play().catch(() => {});
      } catch (e) {}

      // Auto-missed call after 45 seconds (WhatsApp style)
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        setIncomingCall(prev => {
          if (prev && prev.chatId === data.chatId) {
             sendCallLogMessage(data.chatId, data.type, "Missed");
             return null;
          }
          return prev;
        });
        stopRingtone();
      }, 45000);
    });

    socket.on("call:end", (data: any) => {
      setIncomingCall(prev => {
        if (prev?.chatId === data.chatId) {
          // If the caller hung up while we were ringing, log it as a missed call
          sendCallLogMessage(data.chatId, prev.type, "Missed");
          return null;
        }
        return prev;
      });
      stopRingtone();
    });

    socket.on("call:decline", (data: any) => {
      setIncomingCall(prev => (prev?.chatId === data.chatId ? null : prev));
      stopRingtone();
    });

    return () => {
      socket.off("call:start");
      socket.off("call:end");
      socket.off("call:decline");
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [socket]);

  const stopRingtone = () => {
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
      if (socket) {
        socket.emit("call:accept", { chatId: incomingCall.chatId });
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
      if (socket) {
        socket.emit("call:decline", { chatId: incomingCall.chatId });
      }
      stopRingtone();
      sendCallLogMessage(incomingCall.chatId, incomingCall.type, "Declined");
      setIncomingCall(null);
    }
  };

  if (!incomingCall) return null;

  const isVideoCall = incomingCall.type === "video";
  const CallIcon = isVideoCall ? Video : Phone;

  return (
    <Dialog open={!!incomingCall} onOpenChange={onDecline}>
      <DialogContent className="bg-[#313338] text-white border-none overflow-hidden max-w-xs animate-in zoom-in-95 duration-200">
        <DialogHeader className="pt-8 px-6">
          <div className="flex justify-center mb-6">
             <div className="relative">
               <div className={cn(
                 "h-24 w-24 rounded-full flex items-center justify-center shadow-2xl relative z-10",
                 isVideoCall ? "bg-indigo-500 shadow-indigo-500/50" : "bg-emerald-500 shadow-emerald-500/50"
               )}>
                 <CallIcon className="h-12 w-12 text-white animate-pulse" />
               </div>
               <div className={cn(
                 "absolute inset-0 h-24 w-24 rounded-full animate-ping opacity-20",
                 isVideoCall ? "bg-indigo-500" : "bg-emerald-500"
               )} />
             </div>
          </div>
          <DialogTitle className="text-2xl text-center font-bold tracking-tight">
            Incoming {isVideoCall ? "Video" : "Voice"} Call
          </DialogTitle>
          <DialogDescription className="text-center text-zinc-400 text-sm mt-1">
            <span className="font-bold text-indigo-400 text-lg block my-2">
              {incomingCall.callerName || "Unknown Peer"}
            </span>
            is calling your secure node...
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="bg-[#2b2d31]/50 px-6 py-6 mt-6 flex items-center justify-center gap-x-8 border-t border-white/5">
          <button 
            onClick={onDecline}
            className="group flex flex-col items-center gap-y-2"
          >
            <div className="bg-rose-500 hover:bg-rose-600 p-4 rounded-full transition-all hover:scale-110 shadow-lg shadow-rose-500/20 active:scale-95">
              <PhoneOff className="h-6 w-6 text-white" />
            </div>
            <span className="text-[10px] font-bold text-zinc-500 group-hover:text-rose-400 transition uppercase tracking-widest">Decline</span>
          </button>
          
          <button 
            onClick={onAccept}
            className="group flex flex-col items-center gap-y-2"
          >
            <div className="bg-emerald-500 hover:bg-emerald-600 p-4 rounded-full transition-all hover:scale-110 shadow-lg shadow-emerald-500/20 active:scale-95 animate-bounce [animation-duration:2s]">
              <Phone className="h-6 w-6 text-white" />
            </div>
            <span className="text-[10px] font-bold text-zinc-500 group-hover:text-emerald-400 transition uppercase tracking-widest">Accept</span>
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
