"use client";

import React, { useEffect, useState, useRef } from "react";
import { Phone, PhoneOff, Video } from "lucide-react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { useSocket } from "@/components/providers/socket-provider";

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

      // Auto-missed call after 30 seconds
      const timeout = setTimeout(() => {
        setIncomingCall(prev => {
          if (prev && prev.chatId === data.chatId) {
             sendMissedCallMessage(data.chatId);
             return null;
          }
          return prev;
        });
        stopRingtone();
      }, 30000);

      return () => clearTimeout(timeout);
    });

    socket.on("call:end", (data: any) => {
      setIncomingCall(prev => (prev?.chatId === data.chatId ? null : prev));
      stopRingtone();
    });

    return () => {
      socket.off("call:start");
      socket.off("call:end");
    };
  }, [socket]);

  const stopRingtone = () => {
    if (ringtoneRef.current) {
      ringtoneRef.current.pause();
      ringtoneRef.current.currentTime = 0;
    }
  };

  const sendMissedCallMessage = async (chatId: string) => {
    try {
      // In this setup, we use the socket endpoint to send a system message
      await axios.post(`/api/socket/direct-messages?conversationId=${chatId}`, {
        content: "📞 Missed video call",
      });
    } catch (e) {
      console.error("Failed to send missed call message", e);
    }
  };

  const onAccept = () => {
    if (incomingCall) {
      stopRingtone();
      // Redirect to the conversation with video active
      // Since we don't have the serverId, we'll try a relative jump or a known route
      // For now, redirecting to /me will handle the accept via query param
      router.push(`/me?acceptCall=${incomingCall.chatId}`);
      setIncomingCall(null);
    }
  };

  const onDecline = () => {
    if (incomingCall) {
      stopRingtone();
      sendMissedCallMessage(incomingCall.chatId);
      setIncomingCall(null);
    }
  };

  if (!incomingCall) return null;

  return (
    <Dialog open={!!incomingCall} onOpenChange={onDecline}>
      <DialogContent className="bg-[#313338] text-white border-none overflow-hidden max-w-xs animate-in zoom-in-95 duration-200">
        <DialogHeader className="pt-8 px-6">
          <div className="flex justify-center mb-6">
             <div className="relative">
               <div className="h-24 w-24 rounded-full bg-indigo-500 flex items-center justify-center shadow-2xl shadow-indigo-500/50 relative z-10">
                 <Video className="h-12 w-12 text-white animate-pulse" />
               </div>
               <div className="absolute inset-0 h-24 w-24 rounded-full bg-indigo-500 animate-ping opacity-20" />
               <div className="absolute inset-0 h-24 w-24 rounded-full bg-indigo-500 animate-ping opacity-10 [animation-delay:0.5s]" />
             </div>
          </div>
          <DialogTitle className="text-2xl text-center font-bold tracking-tight">
            Incoming Call
          </DialogTitle>
          <DialogDescription className="text-center text-zinc-400 text-sm mt-1">
            <span className="font-semibold text-white">{incomingCall.callerName}</span> is calling your node...
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
