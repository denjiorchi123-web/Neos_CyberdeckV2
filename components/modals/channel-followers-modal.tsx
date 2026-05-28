"use client";

import React, { useState } from "react";
import {
  Check,
  Gavel,
  Loader2,
  MoreVertical,
  Shield,
  ShieldAlert,
  ShieldQuestion
} from "lucide-react";
import axios from "axios";
import { useRouter } from "next/navigation";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuTrigger,
  DropdownMenuSubTrigger
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { UserAvatar } from "@/components/user-avatar";
import { useModal } from "@/hooks/use-modal-store";

const roleIconMap = {
  FOLLOWER: null,
  ADMIN: <ShieldAlert className="h-4 w-4 ml-2 text-rose-500" />
};

export function ChannelFollowersModal() {
  const { isOpen, onOpen, onClose, type, data } = useModal();
  const [loadingId, setLoadingId] = useState("");
  const router = useRouter();

  const isModalOpen = isOpen && type === "channelFollowers";
  const { broadcastChannel } = data;

  const onKick = async (followerId: string) => {
    try {
      setLoadingId(followerId);
      const url = `/api/broadcasts/${broadcastChannel.id}/followers/${followerId}`;
      const response = await axios.delete(url);
      router.refresh();
      onOpen("channelFollowers", { broadcastChannel: response.data });
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingId("");
    }
  };

  const onRoleChange = async (followerId: string, role: string) => {
    try {
      setLoadingId(followerId);
      const url = `/api/broadcasts/${broadcastChannel.id}/followers/${followerId}`;
      const response = await axios.patch(url, { role });
      router.refresh();
      onOpen("channelFollowers", { broadcastChannel: response.data });
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingId("");
    }
  };

  return (
    <Dialog open={isModalOpen} onOpenChange={onClose}>
      <DialogContent className="bg-white text-black overflow-hidden">
        <DialogHeader className="pt-8 px-6">
          <DialogTitle className="text-2xl text-center font-bold">
            Manage Channel Followers
          </DialogTitle>
          <DialogDescription className="text-center text-zinc-500">
            {broadcastChannel?.followers?.length} Followers
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="mt-8 max-h-[420px] pr-6">
          {broadcastChannel?.followers?.map((follower: any) => (
            <div key={follower.id} className="flex items-center gap-x-2 mb-6 px-6">
              <UserAvatar src={follower.profile.imageUrl} />
              <div className="flex flex-col gap-y-1">
                <div className="text-xs font-semibold flex items-center">
                  {follower.profile.name}
                  {roleIconMap[follower.role as keyof typeof roleIconMap]}
                </div>
                <p className="text-xs text-zinc-500">{follower.profile.email || follower.profile.name}</p>
              </div>
              {broadcastChannel.profileId !== follower.profileId &&
                loadingId !== follower.id && (
                  <div className="ml-auto">
                    <DropdownMenu>
                      <DropdownMenuTrigger>
                        <MoreVertical className="h-4 w-4 text-zinc-500" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent side="left">
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger className="flex items-center">
                            <ShieldQuestion className="w-4 h-4 mr-2" />
                            <span>Role</span>
                          </DropdownMenuSubTrigger>
                          <DropdownMenuPortal>
                            <DropdownMenuSubContent>
                              <DropdownMenuItem
                                onClick={() => onRoleChange(follower.id, "FOLLOWER")}
                              >
                                <Shield className="h-4 w-4 mr-2" />
                                Follower
                                {follower.role === "FOLLOWER" && (
                                  <Check className="h-4 w-4 ml-auto" />
                                )}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  onRoleChange(follower.id, "ADMIN")
                                }
                              >
                                <ShieldAlert className="h-4 w-4 mr-2" />
                                Co-Admin
                                {follower.role === "ADMIN" && (
                                  <Check className="h-4 w-4 ml-auto" />
                                )}
                              </DropdownMenuItem>
                            </DropdownMenuSubContent>
                          </DropdownMenuPortal>
                        </DropdownMenuSub>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => onKick(follower.id)}>
                          <Gavel className="h-4 w-4 mr-2" />
                          Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              {loadingId === follower.id && (
                <Loader2 className="animate-spin text-zinc-500 ml-auto w-4 h-4" />
              )}
            </div>
          ))}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
