"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Forward, Search, Send, User, Hash } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useModal } from "@/hooks/use-modal-store";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/user-avatar";
import { useRouter } from "next/navigation";

type Destination = {
  id: string;
  name: string;
  type: "channel" | "conversation";
  imageUrl?: string;
  serverId?: string;
  otherMemberId?: string; // used to send DM via socket API
};

export function ForwardMessageModal() {
  const { isOpen, onClose, type, data } = useModal();
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const router = useRouter();

  const isModalOpen = isOpen && type === "forwardMessage";
  const { message } = data; // message to forward

  useEffect(() => {
    if (isModalOpen) {
      setLoading(true);
      axios.get("/api/forward-destinations").then((res) => {
        setDestinations(res.data);
      }).finally(() => {
        setLoading(false);
      });
    }
  }, [isModalOpen]);

  const onForward = async (dest: Destination) => {
    try {
      setSendingTo(dest.id);
      
      const payload = {
        content: message.content || "",
        fileUrl: message.fileUrl,
        fileName: message.fileName,
        fileSize: message.fileSize,
        mimeType: message.mimeType,
        thumbnailUrl: message.thumbnailUrl,
        mediaKey: message.mediaKey,
        type: message.type,
        isForwarded: true // Preserve forwarding metadata when the schema supports it.
      };

      if (dest.type === "channel") {
        await axios.post(`/api/socket/messages?channelId=${dest.id}&serverId=${dest.serverId}`, payload);
      } else {
        await axios.post(`/api/socket/direct-messages?conversationId=${dest.id}`, payload);
      }
      
      router.refresh();
      onClose();
    } catch (error) {
      console.error(error);
    } finally {
      setSendingTo(null);
    }
  };

  const filtered = destinations.filter(d => d.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <Dialog open={isModalOpen} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-800 text-white overflow-hidden p-0 max-w-md">
        <DialogHeader className="pt-6 px-6 pb-4 border-b border-zinc-700/50">
          <DialogTitle className="text-xl font-bold flex items-center">
            <Forward className="w-5 h-5 mr-2 text-indigo-400" /> Forward Message
          </DialogTitle>
        </DialogHeader>

        <div className="p-4">
          <div className="relative mb-4">
            <Search className="w-4 h-4 absolute left-3 top-3 text-zinc-400" />
            <Input 
              className="bg-zinc-900/50 border-none pl-9 text-zinc-200 focus-visible:ring-0" 
              placeholder="Search chats..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="max-h-[300px] overflow-y-auto space-y-2 pr-2 custom-scrollbar">
            {loading ? (
              <div className="text-center text-zinc-400 py-4">Loading chats...</div>
            ) : filtered.length === 0 ? (
              <div className="text-center text-zinc-400 py-4">No chats found.</div>
            ) : (
              filtered.map(dest => (
                <div key={dest.id} className="flex items-center justify-between p-2 rounded-md hover:bg-zinc-700/50 transition">
                  <div className="flex items-center gap-x-3 overflow-hidden">
                    {dest.type === "conversation" ? (
                      <UserAvatar src={dest.imageUrl} className="h-8 w-8" />
                    ) : (
                      <div className="h-8 w-8 rounded-full bg-zinc-700 flex items-center justify-center shrink-0">
                        <Hash className="h-4 w-4 text-zinc-300" />
                      </div>
                    )}
                    <span className="text-sm font-medium truncate">{dest.name}</span>
                  </div>
                  <button 
                    onClick={() => onForward(dest)}
                    disabled={sendingTo !== null}
                    className="h-8 w-8 rounded-full bg-indigo-500 hover:bg-indigo-600 flex items-center justify-center transition shrink-0 disabled:opacity-50"
                  >
                    <Send className="w-4 h-4 text-white ml-0.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
