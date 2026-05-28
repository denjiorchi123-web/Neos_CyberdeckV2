import { create } from "zustand";
import { Channel, Server } from "@prisma/client";
import { ChannelType } from "@/lib/db";

export type ModalType =
  | "createServer"
  | "invite"
  | "editServer"
  | "members"
  | "createChannel"
  | "leaveServer"
  | "deleteServer"
  | "deleteChannel"
  | "editChannel"
  | "messageFile"
  | "deleteMessage"
  | "chatInfo"
  | "createCommunity"
  | "createBroadcastChannel"
  | "communityMembers"
  | "channelFollowers"
  | "deleteCommunity"
  | "deleteBroadcastChannel"
  | "editCommunity"
  | "editBroadcastChannel";

interface ModalData {
  server?: Server;
  channel?: Channel;
  community?: any;
  broadcastChannel?: any;
  channelType?: string;
  apiUrl?: string;
  query?: Record<string, any>;
  fileType?: string;
  chatType?: "dm" | "group";
  memberId?: string;
  chatName?: string;
  chatImage?: string;
}

interface ModalStore {
  type: ModalType | null;
  data: ModalData;
  isOpen: boolean;
  onOpen: (type: ModalType, data?: ModalData) => void;
  onClose: () => void;
}

export const useModal = create<ModalStore>((set) => ({
  type: null,
  data: {},
  isOpen: false,
  onOpen: (type, data = {}) => set({ isOpen: true, type, data }),
  onClose: () => set({ isOpen: false, type: null })
}));
