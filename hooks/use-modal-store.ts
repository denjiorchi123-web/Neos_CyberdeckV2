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
  | "deleteBroadcastChannel"
  | "editCommunity"
  | "editBroadcastChannel"
  | "forwardMessage"
  | "chatMediaGallery"
  | "muteChat"
  | "clearChat"
  | "chatPinSetup"
  | "forgotPin"
  | "exportChat"
  | "blockUser"
  | "changePin"
  | "unlockChatVerify"
  | "callPinVerify"
  | "deleteCommunity";

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
  memberProfileId?: string;
  chatName?: string;
  chatImage?: string;
  message?: any;
  isDirect?: boolean;
  chatId?: string;
  replyToId?: string;
  onSuccessCallback?: () => void;
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
