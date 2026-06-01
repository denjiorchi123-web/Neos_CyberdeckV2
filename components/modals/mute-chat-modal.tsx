"use client";

import axios from "axios";
import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useModal } from "@/hooks/use-modal-store";
import { Button } from "@/components/ui/button";
import { usePreferences } from "@/components/providers/socket-provider";

export function MuteChatModal() {
  const { isOpen, onClose, type, data } = useModal();
  const router = useRouter();

  const isModalOpen = isOpen && type === "muteChat";
  const { chatId } = data;
  const { mutedChats, refreshPreferences } = usePreferences();

  const [isLoading, setIsLoading] = useState(false);
  const isMuted = mutedChats.some(m => m.chatId === chatId);
  const [duration, setDuration] = useState<number | null>(8); // default 8 hours

  const onClick = async () => {
    try {
      setIsLoading(true);
      if (isMuted) {
        await axios.delete(`/api/mute-chat?chatId=${chatId}`);
      } else {
        await axios.post("/api/mute-chat", { chatId, durationHours: duration });
      }

      refreshPreferences();
      onClose();
      router.refresh();
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isModalOpen} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-800 text-white overflow-hidden">
        <DialogHeader className="pt-8 px-6">
          <DialogTitle className="text-2xl text-center font-bold">
            {isMuted ? "Unmute notifications" : "Mute notifications"}
          </DialogTitle>
          <DialogDescription className="text-center text-zinc-300 mt-2">
            {isMuted ? "You will start receiving push notifications and sounds from this chat again." : "Other participants will not see that you muted this chat. You will still be notified if you are mentioned."}
          </DialogDescription>
        </DialogHeader>
        {!isMuted && (
          <div className="px-6 py-4 flex flex-col gap-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input 
              type="radio" 
              name="muteDuration" 
              value={8} 
              checked={duration === 8} 
              onChange={() => setDuration(8)} 
              className="w-4 h-4 text-indigo-500" 
            />
            <span className="text-sm font-medium">8 hours</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input 
              type="radio" 
              name="muteDuration" 
              value={24} 
              checked={duration === 24} 
              onChange={() => setDuration(24)} 
              className="w-4 h-4 text-indigo-500" 
            />
            <span className="text-sm font-medium">1 week</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input 
              type="radio" 
              name="muteDuration" 
              value={0} 
              checked={duration === 0} 
              onChange={() => setDuration(0)} 
              className="w-4 h-4 text-indigo-500" 
            />
            <span className="text-sm font-medium">Always</span>
          </label>
        </div>
        )}
        <DialogFooter className="bg-zinc-900/50 px-6 py-4">
          <div className="flex items-center justify-between w-full">
            <Button
              disabled={isLoading}
              onClick={onClose}
              variant="ghost"
              className="text-zinc-300 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              disabled={isLoading}
              onClick={onClick}
              className="bg-indigo-500 text-white hover:bg-indigo-600"
            >
              {isMuted ? "Unmute" : "Mute"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
