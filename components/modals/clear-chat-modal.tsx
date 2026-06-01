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

export function ClearChatModal() {
  const { isOpen, onClose, type, data } = useModal();
  const router = useRouter();

  const isModalOpen = isOpen && type === "clearChat";
  const { chatId } = data;

  const [isLoading, setIsLoading] = useState(false);

  const onClick = async () => {
    try {
      setIsLoading(true);
      await axios.post("/api/clear-chat", { chatId });

      onClose();
      router.refresh();
      // Optionally reload the page to completely clear the local chat cache/store
      window.location.reload();
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
            Clear this chat?
          </DialogTitle>
          <DialogDescription className="text-center text-zinc-300 mt-2">
            Messages will be removed for you on this device. They will remain visible to other participants.
          </DialogDescription>
        </DialogHeader>
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
              className="bg-rose-500 text-white hover:bg-rose-600"
            >
              Clear Chat
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
