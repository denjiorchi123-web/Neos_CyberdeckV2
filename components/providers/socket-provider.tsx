"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { io as ClientIO } from "socket.io-client";
import { useModal } from "@/hooks/use-modal-store";
import { useRouter } from "next/navigation";

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

type PreferencesContextType = {
  mutedChats: any[];
  blockedUsers: any[];
  blockedBy: any[];
  lockedChats: any[];
  hasPinEnabled: boolean;
  securityQuestion: string | null;
  refreshPreferences: () => void;
};

const PAIRING_DEDUPE_MS = 10_000;

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
});

const PresenceContext = createContext<PresenceContextType>({
  onlineUsers: [],
});

const PreferencesContext = createContext<PreferencesContextType>({
  mutedChats: [],
  blockedUsers: [],
  blockedBy: [],
  lockedChats: [],
  hasPinEnabled: false,
  securityQuestion: null,
  refreshPreferences: () => {},
});

export const useSocket  = () => useContext(SocketContext);
export const usePresence = () => useContext(PresenceContext);
export const usePreferences = () => useContext(PreferencesContext);

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { onOpen } = useModal();
  const router = useRouter();
  const [socket,      setSocket]      = useState<any>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [mutedChats, setMutedChats] = useState<any[]>([]);
  const [blockedUsers, setBlockedUsers] = useState<any[]>([]);
  const [blockedBy, setBlockedBy] = useState<any[]>([]);
  const [lockedChats, setLockedChats] = useState<any[]>([]);
  const [hasPinEnabled, setHasPinEnabled] = useState(false);
  const [securityQuestion, setSecurityQuestion] = useState<string | null>(null);
  const pairingRequestIdsRef = useRef<Set<string>>(new Set());
  const pairingMacWindowRef = useRef<Map<string, number>>(new Map());

  const openPairingRequest = useCallback((request: Record<string, any>) => {
    const requestId = typeof request?.requestId === "string" ? request.requestId : "";
    if (requestId && pairingRequestIdsRef.current.has(requestId)) return;

    const mac = String(
      request?.fromNodeId ||
      request?.macAddress ||
      request?.mac ||
      "",
    ).trim().toLowerCase();
    const now = Date.now();
    if (mac) {
      const lastSeen = pairingMacWindowRef.current.get(mac) || 0;
      if (now - lastSeen < PAIRING_DEDUPE_MS) return;
      pairingMacWindowRef.current.set(mac, now);
    }

    if (requestId) pairingRequestIdsRef.current.add(requestId);
    onOpen("pairingRequest", { query: request });
  }, [onOpen]);

  const fetchPresence = useCallback(async () => {
    try {
      const res = await fetch("/api/presence");
      const data = await res.json();
      if (data?.online) setOnlineUsers(data.online);
    } catch {}
  }, []);

  useEffect(() => {
    // Resolve URL explicitly (avoids undefined origin issues in some headless environments)
    const socketUrl = window.location.protocol + "//" + window.location.hostname + (window.location.port ? ":" + window.location.port : "");

    const s = new (ClientIO as any)(socketUrl, {
      path:                  "/api/socket/io",
      addTrailingSlash:      false,
      reconnection:          true,
      reconnectionAttempts:  Infinity,
      reconnectionDelay:     1000,
      reconnectionDelayMax:  8000,
      randomizationFactor:   0.5,
      timeout:               10000,
      transports:            ["polling", "websocket"], // Explicitly start with polling to bypass strict WSS blocks, then upgrade
    });

    s.on("connect_error", (err: any) => {
      console.error(`[SocketProvider] Connection error: ${err.message}`, err);
    });

    s.on("reconnect_attempt", (attempt: number) => {
      console.log(`[SocketProvider] Reconnection attempt ${attempt}`);
    });

    const onConnect = async () => {
      console.log("[SocketProvider] Connected successfully with ID:", s.id);
      setIsConnected(true);
      refreshPreferences();
    };

    const refreshPreferences = async () => {
      try {
        const res     = await fetch("/api/auth/me?t=" + Date.now());
        const profile = await res.json();
        
        if (profile?.mutedChats) setMutedChats(profile.mutedChats);
        if (profile?.blockedUsers) setBlockedUsers(profile.blockedUsers);
        if (profile?.blockedBy) setBlockedBy(profile.blockedBy);
        if (profile?.lockedChats) setLockedChats(profile.lockedChats);
        setHasPinEnabled(!!profile?.hasPinEnabled);
        setSecurityQuestion(profile?.securityQuestion || null);

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

    s.on("mesh:pair-request", (data: { mac: string; hostname: string; userId?: string; displayName?: string; publicName?: string; ip: string }) => {
      console.log("[SocketProvider] Received mesh:pair-request global event:", data);
      openPairingRequest(data);
    });

    s.on("mesh:peer-update", (peer: any) => {
      console.log("[SocketProvider] Received mesh:peer-update global event:", peer);
    });

    s.on("ui:navigate", (data: { url: string }) => {
      console.log("[SocketProvider] Received ui:navigate command:", data?.url);
      if (data?.url) router.push(data.url);
    });

    s.on("chat:refresh-list", () => {
      router.refresh();
    });

    setSocket(s);
    fetchPresence();
    const presenceTimer = setInterval(fetchPresence, 5000);
    return () => {
      clearInterval(presenceTimer);
      s.disconnect();
    };
  }, [fetchPresence, openPairingRequest]);

  useEffect(() => {
    const pollIncomingRequests = async () => {
      try {
        const res = await fetch("/api/peers/requests", { cache: "no-store" });
        if (!res.ok) return;
        const [request] = await res.json();
        if (!request) return;
        openPairingRequest(request);
      } catch {}
    };

    pollIncomingRequests();
    const timer = setInterval(pollIncomingRequests, 3000);
    return () => clearInterval(timer);
  }, [openPairingRequest]);

  // Memoize both context values so downstream only re-renders on actual changes
  const socketValue  = useMemo(() => ({ socket, isConnected }), [socket, isConnected]);
  const presenceValue = useMemo(() => ({ onlineUsers }), [onlineUsers]);
  const preferencesValue = useMemo(() => ({ 
    mutedChats, blockedUsers, blockedBy, lockedChats, hasPinEnabled, securityQuestion, 
    refreshPreferences: () => {
      fetch("/api/auth/me?t=" + Date.now()).then(r => r.json()).then(p => {
        if (p?.mutedChats) setMutedChats(p.mutedChats);
        if (p?.blockedUsers) setBlockedUsers(p.blockedUsers);
        if (p?.blockedBy) setBlockedBy(p.blockedBy);
        if (p?.lockedChats) setLockedChats(p.lockedChats);
        setHasPinEnabled(!!p?.hasPinEnabled);
        setSecurityQuestion(p?.securityQuestion || null);
      }).catch(()=>{});
  } }), [mutedChats, blockedUsers, blockedBy, lockedChats, hasPinEnabled, securityQuestion]);

  return (
    <SocketContext.Provider value={socketValue}>
      <PresenceContext.Provider value={presenceValue}>
        <PreferencesContext.Provider value={preferencesValue}>
          {children}
        </PreferencesContext.Provider>
      </PresenceContext.Provider>
    </SocketContext.Provider>
  );
}
