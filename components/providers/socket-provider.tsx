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
      window.location.origin,
      {
        path: "/api/socket/io",
        addTrailingSlash: false,
        // Scenario #9: bounded reconnection with explicit 1s / 2s / 4s backoff.
        // socket.io's default is infinite attempts with internal backoff; we want a
        // bounded retry so a permanently-down server surfaces a UX error instead of
        // silently retrying forever, and the curve matches the spec requested.
        reconnection: true,
        reconnectionAttempts: 3,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 4000,
        randomizationFactor: 0,
        timeout: 10000,
      }
    );

    const onConnect = async () => {
      setIsConnected(true);

      try {
        const res = await fetch("/api/auth/me");
        const profile = await res.json();
        if (profile?.id) {
          socketInstance.emit("presence:identify", profile.id);
        }
      } catch (err) {
        console.error("[Socket] Failed to identify user:", err);
      }
    };

    socketInstance.on("connect", onConnect);

    socketInstance.on("disconnect", (reason: string) => {
      console.log("[Socket] disconnected:", reason);
      setIsConnected(false);
    });

    // Surface reconnection lifecycle for the UI (MediaRoom uses these to show a banner)
    socketInstance.on("reconnect_attempt", (attempt: number) => {
      console.log(`[Socket] reconnect attempt ${attempt}/3`);
    });
    socketInstance.on("reconnect_failed", () => {
      console.error("[Socket] reconnection failed after 3 attempts");
    });

    // Sync the full list of online users on join
    socketInstance.on("presence:sync", (userIds: string[]) => {
      setOnlineUsers(userIds.map(id => ({
        userId: id,
        status: "online" as const
      })));
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
