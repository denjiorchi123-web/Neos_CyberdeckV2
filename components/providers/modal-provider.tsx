"use client";

import React, { useEffect, useState } from "react";

import { CreateServerModal } from "@/components/modals/create-server-modal";
import { InviteModal } from "@/components/modals/invite-modal";
import { EditServerModal } from "@/components/modals/edit-server-modal";
import { MembersModal } from "@/components/modals/members-modal";
import { CreateChannelModal } from "@/components/modals/create-channel-modal";
import { LeaveServerModal } from "@/components/modals/leave-server-modal";
import { DeleteServerModal } from "@/components/modals/delete-server-modal";
import { DeleteChannelModal } from "@/components/modals/delete-channel-modal";
import { EditChannelModal } from "@/components/modals/edit-channel-modal";
import { MessageFileModal } from "@/components/modals/message-file-modal";
import { DeleteMessageModal } from "@/components/modals/delete-message-modal";
import { ChatInfoModal } from "@/components/modals/chat-info-modal";
import { CreateCommunityModal } from "@/components/modals/create-community-modal";
import { CreateBroadcastChannelModal } from "@/components/modals/create-broadcast-channel-modal";
import { CommunityMembersModal } from "@/components/modals/community-members-modal";
import { ChannelFollowersModal } from "@/components/modals/channel-followers-modal";
import { DeleteCommunityModal } from "@/components/modals/delete-community-modal";
import { DeleteBroadcastChannelModal } from "@/components/modals/delete-broadcast-channel-modal";
import { EditCommunityModal } from "@/components/modals/edit-community-modal";
import { EditBroadcastChannelModal } from "@/components/modals/edit-broadcast-channel-modal";
// CallModal removed: incoming-call UI is now driven by CallProvider + IncomingCallOverlay.
// Keeping both registered competing socket listeners (call:start / call:end / call:decline)
// and the cleanup of one would clobber the other's handlers — that was the actual root cause
// of the "zombie ringtone" / "denji keeps ringing" bug.

export function ModalProvider() {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) return null;

  return (
    <>
      <CreateServerModal />
      <InviteModal />
      <EditServerModal />
      <MembersModal />
      <CreateChannelModal />
      <LeaveServerModal />
      <DeleteServerModal />
      <DeleteChannelModal />
      <EditChannelModal />
      <MessageFileModal />
      <DeleteMessageModal />
      <ChatInfoModal />
      <CreateCommunityModal />
      <CreateBroadcastChannelModal />
      <CommunityMembersModal />
      <ChannelFollowersModal />
      <DeleteCommunityModal />
      <DeleteBroadcastChannelModal />
      <EditCommunityModal />
      <EditBroadcastChannelModal />
    </>
  );
}
