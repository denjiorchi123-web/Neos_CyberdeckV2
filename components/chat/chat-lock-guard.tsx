"use client";

import React, { useState, useEffect } from "react";
import axios from "axios";
import { Lock, AlertCircle } from "lucide-react";
import { usePreferences } from "@/components/providers/socket-provider";
import { useModal } from "@/hooks/use-modal-store";

interface ChatLockGuardProps {
  chatId: string;
  children: React.ReactNode;
}

export function ChatLockGuard({ chatId, children }: ChatLockGuardProps) {
  const { lockedChats, hasPinEnabled } = usePreferences();
  const { onOpen } = useModal();
  
  const [unlockedLocally, setUnlockedLocally] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const chatIsLocked = lockedChats.some(lc => lc.chatId === chatId);
  const isLocked = (chatIsLocked && hasPinEnabled) && !unlockedLocally;

  const prevChatIsLocked = React.useRef(chatIsLocked);

  useEffect(() => {
    // If the user clicks "Lock Chat" in the menu, it updates the DB and chatIsLocked becomes true.
    // We should immediately discard the local unlock state.
    if (!prevChatIsLocked.current && chatIsLocked) {
      setUnlockedLocally(false);
    }
    prevChatIsLocked.current = chatIsLocked;
  }, [chatIsLocked]);

  useEffect(() => {
    // WhatsApp-style instant relock: if the user minimizes the app, switches tabs, or locks phone screen.
    const handleVisibilityChange = () => {
      if (document.hidden) {
        setUnlockedLocally(false);
      }
    };
    
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length !== 4) return;

    try {
      setIsLoading(true);
      setError("");
      
      const res = await axios.post("/api/pin/verify", { pin });
      
      if (res.data.success) {
        setUnlockedLocally(true);
        setPin("");
      }
    } catch (err: any) {
      if (err.response?.status === 403) {
        setError("Incorrect PIN.");
      } else {
        setError("An error occurred.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (!isLocked) {
    return (
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {children}
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col items-center justify-center overflow-hidden bg-white dark:bg-[#313338]">
      <div className="max-w-sm w-full p-8 flex flex-col items-center">
        <div className="h-16 w-16 bg-zinc-200 dark:bg-zinc-800 rounded-full flex items-center justify-center mb-6">
          <Lock className="h-8 w-8 text-indigo-500" />
        </div>
        
        <h2 className="text-2xl font-bold mb-2 text-black dark:text-white">Chat Locked</h2>
        <p className="text-zinc-500 text-center mb-8">
          Enter your 4-digit PIN to access this chat.
        </p>

        <form onSubmit={handleUnlock} className="w-full flex flex-col gap-4">
          <input
            autoFocus
            type="password"
            maxLength={4}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            className="w-full text-center tracking-[1em] text-3xl font-mono py-4 rounded-lg bg-zinc-100 dark:bg-zinc-900 border-none focus:ring-2 focus:ring-indigo-500 text-black dark:text-white"
            placeholder="****"
            disabled={isLoading}
          />
          
          {error && (
            <div className="flex items-center justify-center text-rose-500 text-sm">
              <AlertCircle className="h-4 w-4 mr-2" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={pin.length !== 4 || isLoading}
            className="w-full bg-indigo-500 text-white font-semibold py-3 rounded-lg hover:bg-indigo-600 transition disabled:opacity-50"
          >
            {isLoading ? "Unlocking..." : "Unlock"}
          </button>
        </form>

        <button
          onClick={() => onOpen("forgotPin")}
          className="mt-6 text-sm text-indigo-500 hover:underline"
        >
          Forgot PIN?
        </button>
      </div>
    </div>
  );
}
