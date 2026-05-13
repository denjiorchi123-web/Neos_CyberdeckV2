"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { io as ClientIO } from "socket.io-client";

type OnlineUser = {
  userId: string;
  socketId?: string;
  nodeIp?: string;
  lastSeen?: number;
  status: "online" | "offline";
};

type SocketContextType = {
  socket: any | null;
  isConnected: boolean;
  onlineUsers: OnlineUser[];
};

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
  onlineUsers: [],
});

export const useSocket = () => {
  return useContext(SocketContext);
};

// The hardcoded local user ID (matches current-profile.ts)
const LOCAL_USER_ID = "user_2V9vQ4D0Z7p9vQ4D0Z7p9vQ4D0Z";

export function SocketProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);

  // Fetch initial presence state from the API
  const fetchPresence = useCallback(async () => {
    try {
      const res = await fetch("/api/presence");
      const data = await res.json();
      if (data?.online) {
        setOnlineUsers(data.online);
      }
    } catch {
      // Presence API may not be available yet
    }
  }, []);

  useEffect(() => {
    const socketInstance = new (ClientIO as any)(
      process.env.NEXT_PUBLIC_SITE_URL!,
      {
        path: "/api/socket/io",
        addTrailingSlash: false,
      }
    );

    socketInstance.on("connect", () => {
      setIsConnected(true);

      // Identify ourselves for presence tracking
      socketInstance.emit("presence:identify", LOCAL_USER_ID);
    });

    socketInstance.on("disconnect", () => {
      setIsConnected(false);
    });

    // Listen for real-time presence updates
    socketInstance.on(
      "presence:update",
      (data: { userId: string; status: string; socketId?: string }) => {
        setOnlineUsers((prev) => {
          if (data.status === "online") {
            // Add or update user
            const exists = prev.find((u) => u.userId === data.userId);
            if (exists) {
              return prev.map((u) =>
                u.userId === data.userId
                  ? { ...u, status: "online" as const, socketId: data.socketId }
                  : u
              );
            }
            return [
              ...prev,
              {
                userId: data.userId,
                socketId: data.socketId,
                status: "online",
              },
            ];
          } else {
            // Remove user
            return prev.filter((u) => u.userId !== data.userId);
          }
        });
      }
    );

    setSocket(socketInstance);
    fetchPresence();

    return () => socketInstance.disconnect();
  }, [fetchPresence]);

  return (
    <SocketContext.Provider value={{ socket, isConnected, onlineUsers }}>
      {children}
    </SocketContext.Provider>
  );
}
