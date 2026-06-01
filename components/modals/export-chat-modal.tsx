"use client";

import { useState } from "react";
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

export function ExportChatModal() {
  const { isOpen, onClose, type, data } = useModal();
  const [isLoading, setIsLoading] = useState(false);

  const isModalOpen = isOpen && type === "exportChat";
  const { chatId, isDirect } = data; 


  const onExport = async () => {
    try {
      setIsLoading(true);
      const url = `/api/export-chat?chatId=${chatId}&isDirect=${isDirect}`;
      
      const res = await fetch(url);
      const blob = await res.blob();
      
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `chat_export.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);

      onClose();
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
            Export Chat
          </DialogTitle>
          <DialogDescription className="text-center text-zinc-300 mt-2">
            Download a plain-text copy of this chat&apos;s history.
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
              onClick={onExport}
              className="bg-indigo-500 text-white hover:bg-indigo-600"
            >
              Download .txt
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
