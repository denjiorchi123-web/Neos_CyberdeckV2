"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useSocket } from "../components/providers/socket-provider";
import { useRouter } from "next/navigation";
import axios from "axios";

type CallType = "audio" | "video";
type CallStatus = "IDLE" | "RINGING" | "OUTGOING" | "ACTIVE";

interface CallContextType {
  status: CallStatus;
  callType: CallType | null;
  remotePeer: {
    id: string;
    name: string;
    avatar?: string;
  } | null;
  chatId: string | null;
  startCall: (chatId: string, memberId: string, name: string, type: CallType) => Promise<void>;
  acceptCall: () => void;
  declineCall: () => void;
  endCall: () => void;
}

const CallContext = createContext<CallContextType | undefined>(undefined);

export const CallProvider = ({ children }: { children: React.ReactNode }) => {
  const { socket } = useSocket();
  const router = useRouter();
  
  const [status, setStatus] = useState<CallStatus>("IDLE");
  const [callType, setCallType] = useState<CallType | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [remotePeer, setRemotePeer] = useState<CallContextType["remotePeer"]>(null);

  useEffect(() => {
    if (!socket) return;

    socket.on("call:start", (data: any) => {
      if (status !== "IDLE") {
        socket.emit("call:busy", { chatId: data.chatId });
        return;
      }
      setChatId(data.chatId);
      setCallType(data.type);
      setRemotePeer({ id: data.callerMemberId, name: data.callerName });
      setStatus("RINGING");
    });

    socket.on("call:end", (data: any) => {
      if (data.chatId === chatId) {
        setStatus("IDLE");
        setChatId(null);
        setRemotePeer(null);
      }
    });

    socket.on("call:accept", (data: any) => {
      if (data.chatId === chatId) {
        setStatus("ACTIVE");
      }
    });

    socket.on("call:decline", (data: any) => {
      if (data.chatId === chatId) {
        setStatus("IDLE");
        setChatId(null);
        setRemotePeer(null);
      }
    });

    return () => {
      socket.off("call:start");
      socket.off("call:end");
      socket.off("call:accept");
      socket.off("call:decline");
    };
  }, [socket, status, chatId]);

  const startCall = async (id: string, memberId: string, name: string, type: CallType) => {
    setChatId(id);
    setCallType(type);
    setRemotePeer({ id: memberId, name });
    setStatus("OUTGOING");
    
    if (socket) {
      socket.emit("call:start", {
        chatId: id,
        callerMemberId: memberId, // Should be current user's member ID
        callerName: "You",
        type
      });
    }
  };

  const acceptCall = () => {
    if (socket && chatId) {
      socket.emit("call:accept", { chatId });
      setStatus("ACTIVE");
    }
  };

  const declineCall = () => {
    if (socket && chatId) {
      socket.emit("call:decline", { chatId });
      setStatus("IDLE");
    }
  };

  const endCall = () => {
    if (socket && chatId) {
      socket.emit("call:end", { chatId });
      setStatus("IDLE");
    }
  };

  return (
    <CallContext.Provider value={{ 
      status, 
      callType, 
      remotePeer, 
      chatId,
      startCall,
      acceptCall,
      declineCall,
      endCall
    }}>
      {children}
    </CallContext.Provider>
  );
};

export const useCall = () => {
  const context = useContext(CallContext);
  if (context === undefined) {
    throw new Error("useCall must be used within a CallProvider");
  }
  return context;
};
