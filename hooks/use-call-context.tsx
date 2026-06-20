"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { useSocket } from "../components/providers/socket-provider";
import { useRouter } from "next/navigation";
import { IncomingRingtone } from "../lib/audio-tones";

type CallType = "audio" | "video";
type CallStatus = "IDLE" | "RINGING" | "OUTGOING" | "ACTIVE";

interface CallContextType {
  status: CallStatus;
  callType: CallType | null;
  remotePeer: {
    id: string;
    name: string;
    avatar?: string;
  } | null;
  chatId: string | null;
  startCall: (chatId: string, memberId: string, name: string, type: CallType) => Promise<void>;
  acceptCall: () => void;
  declineCall: () => void;
  endCall: () => void;
}

const CallContext = createContext<CallContextType | undefined>(undefined);

export const CallProvider = ({ children }: { children: React.ReactNode }) => {
  const { socket } = useSocket();
  const router = useRouter();

  const [status, setStatus] = useState<CallStatus>("IDLE");
  const [callType, setCallType] = useState<CallType | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [remotePeer, setRemotePeer] = useState<CallContextType["remotePeer"]>(null);

  // Per-call metadata kept in refs so the signaling effect can stay stable (deps = [socket]
  // only) and the listener handlers can read the latest values without stale closures.
  const callIdRef = useRef<string | null>(null);
  const callerUserIdRef = useRef<string | null>(null);
  const serverIdRef = useRef<string | null>(null);
  const callerMemberIdRef = useRef<string | null>(null);
  const chatIdRef = useRef<string | null>(null);
  const callTypeRef = useRef<CallType | null>(null);

  // Dead-call registry: callIds known to have ended. Prevents a late-arriving call:start
  // (e.g. mesh redelivery) from re-ringing.
  const endedCallIdsRef = useRef<Set<string>>(new Set());
  const markCallEnded = (id: string | null | undefined) => {
    if (!id) return;
    endedCallIdsRef.current.add(id);
    setTimeout(() => endedCallIdsRef.current.delete(id), 60000);
  };

  // Incoming ringtone — HTML Audio + pure-JS WAV synthesis, no user gesture needed.
  const ringtoneRef = useRef<IncomingRingtone | null>(null);
  const shouldPlayRef = useRef(false);
  const autoMissTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Scenario #13 — cross-tab coordination. All tabs of the same user receive the same
  // call:start (server routes by user-room). We only auto-play the ringtone on the
  // currently-visible tab, and broadcast accept/decline to the others so they dismiss
  // silently without playing any sound.
  const broadcastRef = useRef<BroadcastChannel | null>(null);

  const stopRingtone = () => {
    shouldPlayRef.current = false;
    if (ringtoneRef.current) {
      ringtoneRef.current.stop();
      ringtoneRef.current = null;
    }
  };

  const playRingtone = () => {
    // Scenario #13 — only auto-play on the visible tab. Hidden tabs still mount the
    // overlay UI (so when the user switches to them the ringing call is visible), but
    // they stay silent. visibilitychange listener below will start audio if the user
    // pulls this tab into focus while still ringing.
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      console.log("[CyberDeck:Call] Tab not visible — suppressing ringtone autoplay");
      shouldPlayRef.current = true; // arm it so a visibilitychange flip starts the audio
      return;
    }
    try {
      if (!ringtoneRef.current) {
        ringtoneRef.current = new IncomingRingtone();
      }
      shouldPlayRef.current = true;
      ringtoneRef.current.play();
      console.log("[CyberDeck:Call] Incoming ringtone playing");
    } catch (e) {
      console.error("[CyberDeck:Call] ringtone play error:", e);
    }
  };

  const resetCall = () => {
    stopRingtone();
    if (autoMissTimeoutRef.current) {
      clearTimeout(autoMissTimeoutRef.current);
      autoMissTimeoutRef.current = null;
    }
    callIdRef.current = null;
    callerUserIdRef.current = null;
    serverIdRef.current = null;
    callerMemberIdRef.current = null;
    chatIdRef.current = null;
    callTypeRef.current = null;
    setStatus("IDLE");
    setChatId(null);
    setRemotePeer(null);
    setCallType(null);
  };

  useEffect(() => {
    if (!socket) return;

    const onCallStart = (data: any) => {
      console.log("[CallProvider] call:start", data);

      // Drop a callId we've already marked ended (handles out-of-order delivery).
      if (data.callId && endedCallIdsRef.current.has(data.callId)) return;

      // Duplicate delivery of the same in-flight call: ignore.
      if (data.callId && callIdRef.current === data.callId) return;

      // Already in a call — either via CallProvider.startCall (chatIdRef set) OR via a
      // URL-driven MediaRoom that the chat button navigated to (has video/audio params).
      // This catches the simultaneous-dial race: if A and B both click Call at the same
      // time, both will have ?video=true or ?audio=true in their URL, so each replies
      // call:busy to the other, and both MediaRooms show "Line Busy" and auto-dismiss.
      const isInCallViaUrl =
        typeof window !== "undefined" &&
        (new URLSearchParams(window.location.search).has("video") ||
          new URLSearchParams(window.location.search).has("audio"));

      if (chatIdRef.current !== null || isInCallViaUrl) {
        socket.emit("call:busy", {
          chatId: data.chatId,
          callId: data.callId ?? undefined,
          targetUserId: data.callerUserId,
        });
        return;
      }

      callIdRef.current = data.callId ?? null;
      callerUserIdRef.current = data.callerUserId ?? null;
      serverIdRef.current = data.serverId ?? null;
      callerMemberIdRef.current = data.callerMemberId ?? null;
      chatIdRef.current = data.chatId;
      callTypeRef.current = data.type;

      setChatId(data.chatId);
      setCallType(data.type);
      setRemotePeer({ id: data.callerMemberId, name: data.callerName });
      setStatus("RINGING");

      playRingtone();

      if (autoMissTimeoutRef.current) clearTimeout(autoMissTimeoutRef.current);
      autoMissTimeoutRef.current = setTimeout(() => {
        if (callIdRef.current === data.callId) {
          markCallEnded(data.callId);
          resetCall();
        }
      }, 45000);
    };

    const onCallEnd = (data: any) => {
      console.log("[CallProvider] call:end", data);
      const incomingCallId = data?.callId;
      markCallEnded(incomingCallId);
      // Strict callId match — matching on chatId alone could close a brand-new call attempt
      // in the same conversation if a stale fail-safe broadcast for the previous call arrives.
      if (incomingCallId && callIdRef.current === incomingCallId) {
        resetCall();
      }
    };

    const onCallDecline = (data: any) => {
      console.log("[CallProvider] call:decline", data);
      const incomingCallId = data?.callId;
      markCallEnded(incomingCallId);
      if (incomingCallId && callIdRef.current === incomingCallId) {
        resetCall();
      }
    };

    const onCallAccept = (data: any) => {
      console.log("[CallProvider] call:accept", data);
      const incomingCallId = data?.callId;
      if (incomingCallId && callIdRef.current === incomingCallId) {
        setStatus("ACTIVE");
      }
    };

    // Scenario #3 — caller's 30s timer fired before we picked up. Stop ringing immediately
    // and drop the registry entry so any stray retransmits can't re-ring.
    const onCallTimeout = (data: any) => {
      console.log("[CallProvider] call:timeout", data);
      const incomingCallId = data?.callId;
      markCallEnded(incomingCallId);
      if (incomingCallId && callIdRef.current === incomingCallId) {
        resetCall();
      }
    };

    socket.on("call:start", onCallStart);
    socket.on("call:end", onCallEnd);
    socket.on("call:decline", onCallDecline);
    socket.on("call:accept", onCallAccept);
    socket.on("call:timeout", onCallTimeout);

    return () => {
      socket.off("call:start", onCallStart);
      socket.off("call:end", onCallEnd);
      socket.off("call:decline", onCallDecline);
      socket.off("call:accept", onCallAccept);
      socket.off("call:timeout", onCallTimeout);
    };
  }, [socket]);

  // Cold-Boot Wakeup: Hardware interrupt launched UI directly to this URL
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("incomingCall") === "1" && !chatIdRef.current) {
      const pCallId = params.get("callId");
      if (pCallId && endedCallIdsRef.current.has(pCallId)) return;
      
      callIdRef.current = pCallId;
      chatIdRef.current = params.get("chatId");
      callTypeRef.current = (params.get("callType") || "audio") as CallType;
      
      setChatId(params.get("chatId"));
      setCallType(callTypeRef.current);
      setRemotePeer({ id: "unknown", name: params.get("callerName") || "Incoming Call" });
      setStatus("RINGING");
      
      playRingtone();
      
      if (autoMissTimeoutRef.current) clearTimeout(autoMissTimeoutRef.current);
      autoMissTimeoutRef.current = setTimeout(() => {
        if (callIdRef.current === pCallId) {
          markCallEnded(pCallId);
          resetCall();
        }
      }, 45000);
      
      // Clear URL params so refresh doesn't trigger it again
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // Scenario #13 — BroadcastChannel for cross-tab dismiss.
  // When the user accepts or declines in one tab, the other tabs of the same user listen
  // here and silently dismiss their own overlay + stop their ringtone (without playing
  // any "ended" sound, per spec).
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const bc = new BroadcastChannel("cyberdeck-calls");
    broadcastRef.current = bc;

    bc.onmessage = (event) => {
      const msg = event.data || {};
      if (!msg.callId) return;
      // Only react if this tab is currently ringing for the same call.
      if (callIdRef.current !== msg.callId) return;

      if (msg.type === "accepted-elsewhere") {
        console.log("[CyberDeck:Call] #13 accepted-elsewhere — silent dismiss");
        stopRingtone();
        resetCall();
      } else if (msg.type === "declined-elsewhere") {
        console.log("[CyberDeck:Call] #13 declined-elsewhere — silent dismiss");
        stopRingtone();
        resetCall();
      }
    };

    return () => {
      try { bc.close(); } catch { /* noop */ }
      broadcastRef.current = null;
    };
  }, []);

  // Scenario #13 — start audio when the tab becomes visible while still ringing.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => {
      if (document.visibilityState === "visible" && shouldPlayRef.current) {
        console.log("[CyberDeck:Call] #13 tab now visible — starting ringtone");
        try {
          if (!ringtoneRef.current) {
            ringtoneRef.current = new IncomingRingtone();
          }
          ringtoneRef.current.play();
        } catch (e) {
          console.error("[CyberDeck:Call] visibility ringtone play error:", e);
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const startCall = useCallback(async (id: string, memberId: string, name: string, type: CallType) => {
    setChatId(id);
    setCallType(type);
    setRemotePeer({ id: memberId, name });
    setStatus("OUTGOING");
    chatIdRef.current = id;
    callTypeRef.current = type;

    if (socket) {
      socket.emit("call:start", {
        chatId: id,
        callerMemberId: memberId,
        callerName: "You",
        type,
      });
    }
  }, [socket]);

  const acceptCall = useCallback(() => {
    if (!chatIdRef.current) return;
    console.log("[CyberDeck:Call] #2/#13 acceptCall, callId:", callIdRef.current);
    stopRingtone();
    if (autoMissTimeoutRef.current) {
      clearTimeout(autoMissTimeoutRef.current);
      autoMissTimeoutRef.current = null;
    }
    markCallEnded(callIdRef.current);

    // Tell other tabs of this user to dismiss silently.
    if (broadcastRef.current && callIdRef.current) {
      broadcastRef.current.postMessage({ type: "accepted-elsewhere", callId: callIdRef.current });
    }

    if (socket) {
      socket.emit("call:accept", {
        chatId: chatIdRef.current,
        callId: callIdRef.current ?? undefined,
        targetUserId: callerUserIdRef.current ?? undefined,
      });
    }

    setStatus("ACTIVE");

    // Drive the recipient into the conversation page so MediaRoom can mount and pick up
    // the WebRTC handshake.
    const serverId = serverIdRef.current;
    const otherMemberId = callerMemberIdRef.current;
    const acceptedCallId = callIdRef.current;
    const isVideo = callTypeRef.current === "video";
    if (serverId && otherMemberId) {
      const queryParam = isVideo ? "video=true" : "audio=true";
      const callIdParam = acceptedCallId ? `&callId=${acceptedCallId}` : "";
      router.push(`/servers/${serverId}/conversations/${otherMemberId}?${queryParam}${callIdParam}`);
    }
  }, [socket, router]);

  const declineCall = useCallback(() => {
    if (!chatIdRef.current) return;
    console.log("[CyberDeck:Call] #2/#13 declineCall, callId:", callIdRef.current);
    if (autoMissTimeoutRef.current) {
      clearTimeout(autoMissTimeoutRef.current);
      autoMissTimeoutRef.current = null;
    }
    markCallEnded(callIdRef.current);

    if (broadcastRef.current && callIdRef.current) {
      broadcastRef.current.postMessage({ type: "declined-elsewhere", callId: callIdRef.current });
    }

    if (socket) {
      socket.emit("call:decline", {
        chatId: chatIdRef.current,
        callId: callIdRef.current ?? undefined,
        targetUserId: callerUserIdRef.current ?? undefined,
      });
    }
    resetCall();
  }, [socket]);

  const endCall = useCallback(() => {
    if (!chatIdRef.current) return;
    if (autoMissTimeoutRef.current) {
      clearTimeout(autoMissTimeoutRef.current);
      autoMissTimeoutRef.current = null;
    }
    markCallEnded(callIdRef.current);

    if (socket) {
      socket.emit("call:end", {
        chatId: chatIdRef.current,
        callId: callIdRef.current ?? undefined,
        targetUserId: callerUserIdRef.current ?? undefined,
      });
    }
    resetCall();
  }, [socket]);

  return (
    <CallContext.Provider value={{
      status,
      callType,
      remotePeer,
      chatId,
      startCall,
      acceptCall,
      declineCall,
      endCall
    }}>
      {children}
    </CallContext.Provider>
  );
};

export const useCall = () => {
  const context = useContext(CallContext);
  if (context === undefined) {
    throw new Error("useCall must be used within a CallProvider");
  }
  return context;
};
