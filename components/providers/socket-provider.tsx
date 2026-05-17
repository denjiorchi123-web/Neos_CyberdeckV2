"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from "react";
import { io as ClientIO } from "socket.io-client";

type OnlineUser = {
  userId: string;
  socketId?: string;
  nodeIp?: string;
  lastSeen?: number;
  status: "online" | "offline";
};

// Split into two contexts so components that only need socket/isConnected
// don't re-render when onlineUsers changes.
type SocketContextType = {
  socket: any | null;
  isConnected: boolean;
};

type PresenceContextType = {
  onlineUsers: OnlineUser[];
};

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
});

const PresenceContext = createContext<PresenceContextType>({
  onlineUsers: [],
});

export const useSocket  = () => useContext(SocketContext);
export const usePresence = () => useContext(PresenceContext);

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const [socket,      setSocket]      = useState<any>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);

  const fetchPresence = useCallback(async () => {
    try {
      const res = await fetch("/api/presence");
      const data = await res.json();
      if (data?.online) setOnlineUsers(data.online);
    } catch {}
  }, []);

  useEffect(() => {
    const s = new (ClientIO as any)(window.location.origin, {
      path:                  "/api/socket/io",
      addTrailingSlash:      false,
      reconnection:          true,
      reconnectionAttempts:  3,
      reconnectionDelay:     1000,
      reconnectionDelayMax:  4000,
      randomizationFactor:   0,
      timeout:               10000,
    });

    const onConnect = async () => {
      setIsConnected(true);
      try {
        const res     = await fetch("/api/auth/me");
        const profile = await res.json();
        if (profile?.id) s.emit("presence:identify", profile.id);
      } catch {}
    };

    s.on("connect",    onConnect);
    s.on("disconnect", () => setIsConnected(false));

    s.on("presence:sync", (userIds: string[]) => {
      setOnlineUsers(userIds.map(id => ({ userId: id, status: "online" as const })));
    });

    s.on("presence:update", (data: { userId: string; status: string; socketId?: string }) => {
      setOnlineUsers(prev => {
        if (data.status === "online") {
          const exists = prev.find(u => u.userId === data.userId);
          if (exists) return prev.map(u => u.userId === data.userId ? { ...u, status: "online" as const, socketId: data.socketId } : u);
          return [...prev, { userId: data.userId, socketId: data.socketId, status: "online" as const }];
        }
        return prev.filter(u => u.userId !== data.userId);
      });
    });

    setSocket(s);
    fetchPresence();
    return () => s.disconnect();
  }, [fetchPresence]);

  // Memoize both context values so downstream only re-renders on actual changes
  const socketValue  = useMemo(() => ({ socket, isConnected }), [socket, isConnected]);
  const presenceValue = useMemo(() => ({ onlineUsers }), [onlineUsers]);

  return (
    <SocketContext.Provider value={socketValue}>
      <PresenceContext.Provider value={presenceValue}>
        {children}
      </PresenceContext.Provider>
    </SocketContext.Provider>
  );
}
