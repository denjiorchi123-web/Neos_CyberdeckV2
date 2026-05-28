import { create } from "zustand";

interface ChatFilterStore {
  activeTab: "All" | "Unread" | "Groups" | "Communities" | "Channels" | "Archived";
  setActiveTab: (tab: "All" | "Unread" | "Groups" | "Communities" | "Channels" | "Archived") => void;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
}

export const useChatFilterStore = create<ChatFilterStore>((set) => ({
  activeTab: "All",
  setActiveTab: (activeTab) => set({ activeTab }),
  searchTerm: "",
  setSearchTerm: (searchTerm) => set({ searchTerm }),
}));
