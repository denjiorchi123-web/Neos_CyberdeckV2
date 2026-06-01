import { create } from "zustand";

interface ReplyMessage {
  id: string;
  content: string;
  memberName: string;
  fileUrl?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  type?: string;
  thumbnailUrl?: string | null;
}

interface ReplyStore {
  replyingTo: ReplyMessage | null;
  setReplyingTo: (message: ReplyMessage | null) => void;
}

export const useReplyStore = create<ReplyStore>((set) => ({
  replyingTo: null,
  setReplyingTo: (message) => set({ replyingTo: message })
}));
