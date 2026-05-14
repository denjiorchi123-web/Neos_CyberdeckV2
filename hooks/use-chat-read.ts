import { useEffect } from "react";
import axios from "axios";
import { useSocket } from "@/components/providers/socket-provider";

interface ChatReadProps {
  chatId: string;
  apiUrl: string; // e.g. /api/socket/direct-messages
  isEnabled: boolean;
}

export const useChatRead = ({
  chatId,
  apiUrl,
  isEnabled
}: ChatReadProps) => {
  const { socket, isConnected } = useSocket();

  useEffect(() => {
    if (!isEnabled || !isConnected || !socket || !chatId) return;

    // 1. Mark existing messages as read on mount/chat change
    const markAsRead = async () => {
      try {
        await axios.patch(`${apiUrl}/read?conversationId=${chatId}`);
      } catch (error) {
        console.error("[CHAT_READ_ERROR]", error);
      }
    };

    markAsRead();

    // 2. Listen for new incoming messages and mark them as read immediately if we are active
    const addKey = `chat:${chatId}:messages`;
    
    const onNewMessage = (message: any) => {
      // If the message is from someone else, mark it as read
      // We don't have the current user ID here easily, but the API handles the check
      // To avoid spamming, we can just call the read API
      markAsRead();
    };

    socket.on(addKey, onNewMessage);

    return () => {
      socket.off(addKey, onNewMessage);
    };
  }, [chatId, apiUrl, isEnabled, socket, isConnected]);
};
