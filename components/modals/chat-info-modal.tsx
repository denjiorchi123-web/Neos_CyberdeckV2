"use client";

import React, { useEffect, useState } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";
import { Phone, Video, Users, LogOut, UserPlus } from "lucide-react";
import { format } from "date-fns";

import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { useModal } from "@/hooks/use-modal-store";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import qs from "query-string";
import { v4 as uuidv4 } from "uuid";

export function ChatInfoModal() {
  const { isOpen, onClose, type, data } = useModal();
  const router = useRouter();

  const isModalOpen = isOpen && type === "chatInfo";
  const { chatType, chatName, chatImage, memberId, server } = data;

  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);

  useEffect(() => {
    if (isModalOpen) {
      axios.get("/api/auth/me").then(res => setCurrentUser(res.data)).catch(() => {});
      
      if (chatType === "group" && server?.id) {
        setLoading(true);
        axios.get(`/api/servers/${server.id}`)
          .then(res => {
            setMembers(res.data?.members || []);
          })
          .catch(console.error)
          .finally(() => setLoading(false));
      }
    }
  }, [isModalOpen, chatType, server?.id]);

  if (!isModalOpen) return null;

  const initials = (chatName || "G").slice(0, 2).toUpperCase();
  const isAdmin = members.find(m => m.profileId === currentUser?.id)?.role === "ADMIN";

  const onCall = (video: boolean) => {
    onClose();
    const url = qs.stringifyUrl({
      url: window.location.pathname,
      query: {
        [video ? "video" : "audio"]: true,
        start: true,
        callId: uuidv4()
      }
    });
    router.push(url);
  };

  const onLeaveGroup = async () => {
    if (confirm(`Are you sure you want to leave "${chatName}"?`)) {
      try {
        await axios.patch(`/api/servers/${server?.id}/leave`);
        onClose();
        router.push("/me");
        router.refresh();
      } catch (error) {
        console.error(error);
      }
    }
  };

  const onMemberClick = (clickedMemberId: string) => {
    if (clickedMemberId === currentUser?.id) return;
    onClose();
    // In our DB, conversation routes use memberId. 
    // We navigate to /servers/[serverId]/conversations/[memberId]
    router.push(`/servers/${server?.id}/conversations/${clickedMemberId}`);
  };

  return (
    <Dialog open={isModalOpen} onOpenChange={onClose}>
      <DialogContent className="bg-white dark:bg-[#313338] text-black dark:text-white p-0 overflow-hidden sm:max-w-[425px]">
        <div className="flex flex-col items-center pt-8 pb-4 px-6 bg-zinc-100 dark:bg-[#2b2d31]">
          {chatType === "group" && !chatImage ? (
            <div className="h-24 w-24 rounded-full bg-indigo-500 flex items-center justify-center shadow-md mb-4">
              <span className="text-white text-3xl font-bold">{initials}</span>
            </div>
          ) : (
            <UserAvatar src={chatImage} className="h-24 w-24 mb-4 shadow-md" />
          )}
          
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-white text-center">
            {chatName}
          </h2>
          
          {chatType === "dm" && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              CyberDeck Contact
            </p>
          )}
          {chatType === "group" && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              Group • {members.length} participants
            </p>
          )}

          <div className="flex gap-x-6 mt-6">
            <div className="flex flex-col items-center gap-y-2 cursor-pointer group" onClick={() => onCall(false)}>
              <div className="h-10 w-10 rounded-full bg-indigo-500/10 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center group-hover:bg-indigo-500 group-hover:text-white transition">
                <Phone className="h-5 w-5" />
              </div>
              <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">Audio</span>
            </div>
            <div className="flex flex-col items-center gap-y-2 cursor-pointer group" onClick={() => onCall(true)}>
              <div className="h-10 w-10 rounded-full bg-indigo-500/10 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center group-hover:bg-indigo-500 group-hover:text-white transition">
                <Video className="h-5 w-5" />
              </div>
              <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">Video</span>
            </div>
          </div>
        </div>

        {chatType === "group" && (
          <div className="flex flex-col p-6 space-y-4 max-h-[400px]">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-600 dark:text-zinc-400 uppercase">
                Participants
              </h3>
              {isAdmin && (
                <button className="text-xs text-indigo-500 hover:underline flex items-center gap-1">
                  <UserPlus className="h-3 w-3" /> Add
                </button>
              )}
            </div>
            
            <ScrollArea className="flex-1">
              <div className="space-y-3 pr-4">
                {members.map(member => (
                  <div 
                    key={member.id} 
                    onClick={() => onMemberClick(member.id)}
                    className="flex items-center gap-x-3 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-700/50 p-2 rounded-md transition"
                  >
                    <UserAvatar src={member.profile.imageUrl} className="h-8 w-8" />
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold flex items-center gap-x-1">
                        {member.profile.name}
                        {member.profileId === currentUser?.id && <span className="text-xs text-zinc-500 font-normal">(You)</span>}
                      </span>
                      <span className="text-[11px] text-zinc-500 capitalize">{member.role.toLowerCase()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <Button 
              onClick={onLeaveGroup}
              variant="destructive" 
              className="w-full flex items-center gap-x-2 mt-4"
            >
              <LogOut className="h-4 w-4" />
              Leave Group
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
