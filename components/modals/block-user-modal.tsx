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

export function BlockUserModal() {
  const { isOpen, onClose, type, data } = useModal();
  const router = useRouter();

  const isModalOpen = isOpen && type === "blockUser";
  const { memberId, memberProfileId } = data as { memberId?: string, memberProfileId?: string };
  const { blockedUsers, refreshPreferences } = usePreferences();

  const [isLoading, setIsLoading] = useState(false);
  const isBlocked = blockedUsers.some(u => u.blockedId === memberProfileId);

  const onClick = async () => {
    try {
      setIsLoading(true);
      if (isBlocked) {
        await axios.delete(`/api/block-user?memberId=${memberId}`);
      } else {
        await axios.post("/api/block-user", { memberId });
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
            {isBlocked ? "Unblock User" : "Block User"}
          </DialogTitle>
          <DialogDescription className="text-center text-zinc-300 mt-2">
            {isBlocked ? "Are you sure you want to unblock this user? They will be able to send you messages and call you again." : "Are you sure you want to block this user? They will no longer be able to send you direct messages."}
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
              className={isBlocked ? "bg-indigo-500 text-white hover:bg-indigo-600" : "bg-rose-500 text-white hover:bg-rose-600"}
            >
              {isBlocked ? "Unblock User" : "Block User"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
