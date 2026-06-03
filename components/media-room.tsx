"use client";

import React, { useEffect, useRef, useState, useCallback, useTransition } from "react";
import { Loader2, Mic, MicOff, Video, VideoOff, PhoneOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSocket } from "@/components/providers/socket-provider";
import { usePathname, useRouter } from "next/navigation";
import qs from "query-string";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import { isWebRTCSupported } from "@/lib/webrtc-support";
import { CallTone, playCallEndedSound } from "@/lib/audio-tones";

interface MediaRoomProps {
  chatId: string;
  video: boolean;
  audio: boolean;
  peerName?: string;
  peerImageUrl?: string;
  currentProfileName?: string;
  isInitiator?: boolean;
  serverId?: string;
  callerMemberId?: string;
  callId?: string;
  // Profile IDs used for per-user signaling routing in 1:1 DM calls
  callerUserId?: string;
  targetUserId?: string;
}

interface PeerConnection {
  pc: RTCPeerConnection;
  remoteStream: MediaStream;
}

// LAN-only: no STUN/TURN needed — direct host candidates work
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [],
};

export function MediaRoom({
  chatId,
  video,
  audio,
  peerName,
  peerImageUrl,
  currentProfileName,
  isInitiator,
  serverId,
  callerMemberId,
  callId,
  callerUserId,
  targetUserId
}: MediaRoomProps) {
  const { socket, isConnected } = useSocket() as { socket: any; isConnected: boolean };
  const router = useRouter();
  const pathName = usePathname();
  const [isJoined, setIsJoined] = useState(false);
  const [isMuted, setIsMuted] = useState(!audio);
  const [isVideoOff, setIsVideoOff] = useState(!video);
  const [peers, setPeers] = useState<Map<string, PeerConnection>>(new Map());

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, PeerConnection>>(new Map());

  // Structured error/status state that drives the full-screen overlays for scenarios
  // #1 (offline), #2 (declined), #3 (no answer), #4 (busy), #5 (mic), #7 (ice failed),
  // #12 (unsupported), and the dropped/generic catch-alls. Keeps the rendering logic
  // a single switch instead of string-matching on error messages.
  type ErrorKind =
    | "offline"
    | "declined"
    | "busy"
    | "no_answer"
    | "mic_denied"
    | "no_mic"
    | "no_camera"
    | "ice_failed"   // retryable
    | "ice_dropped"  // terminal after retry
    | "browser_unsupported"
    | "generic";
  type CallErrorState = { kind: ErrorKind; message: string };
  const [errorState, setErrorState] = useState<CallErrorState | null>(null);
  // Back-compat string getter for places that still treat the error as a plain string.
  const error = errorState?.message ?? null;
  const setError = (msg: string | null) => {
    setErrorState(msg ? { kind: "generic", message: msg } : null);
  };
  const showError = (kind: ErrorKind, message: string) => {
    console.log(`[CyberDeck:Call] showError kind=${kind} msg="${message}"`);
    setErrorState({ kind, message });
  };

  const [duration, setDuration] = useState(0);
  const isEndingRef = useRef(false);
  const [callEndedState, setCallEndedState] = useState<string | null>(null);
  const [isPeerConnected, setIsPeerConnected] = useState(false);
  const [isPending, startTransition] = useTransition();
  const durationRef = useRef(0);
  const signalSentRef = useRef(false);
  // Mirror isPeerConnected into a ref so leaveCall can read the latest value without
  // depending on the state variable (which would otherwise re-create leaveCall and
  // re-trigger the join effect's cleanup the instant the peer connects).
  const isPeerConnectedRef = useRef(false);
  // callId now comes from props to ensure sync with ChatHeader buttons

  // Scenario #8: ICE-restart / reconnecting state shown to the user during a transient
  // network drop. The actual reconnect logic lives in pc.oniceconnectionstatechange below.
  const [isReconnecting, setIsReconnecting] = useState(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Scenario #5: when the camera is unavailable (no device or permission denied) on what
  // was supposed to be a video call, we transparently fall back to audio-only.
  // Mirror into a ref so async code (joinRoom's call:start emit) reads the live value
  // rather than the stale closure capture from initial render.
  const [cameraUnavailable, setCameraUnavailable] = useState(false);
  const cameraUnavailableRef = useRef(false);
  const markCameraUnavailable = () => {
    cameraUnavailableRef.current = true;
    setCameraUnavailable(true);
  };

  // Tracks every timer/interval we start so the cleanup path can drain all of them (#15).
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const intervalsRef = useRef<Set<ReturnType<typeof setInterval>>>(new Set());
  const trackTimer = (t: ReturnType<typeof setTimeout>) => { timersRef.current.add(t); return t; };
  const trackInterval = (i: ReturnType<typeof setInterval>) => { intervalsRef.current.add(i); return i; };

  // Scenario #11: ICE candidates can arrive on the wire before we've finished
  // setRemoteDescription. Buffer them per-peer and drain after remoteDescription is set.
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

  // Scenario #7: ICE-failed retry. First fail → show retry overlay. Retry clicks
  // restartIce() on the current peer connection. Second fail → "Unable to Connect".
  const retryAttemptedRef = useRef(false);
  const [, forceRender] = useState(0);
  const bumpRender = () => forceRender((n) => n + 1);

  // Scenario #14: poor-call-quality detection. Banner is amber when packetLoss > 10%,
  // RTT > 300ms, or jitter > 50ms. Hidden again after 2 consecutive normal samples.
  const [weakConnection, setWeakConnection] = useState(false);
  const consecutiveNormalChecksRef = useRef(0);
  const statsLogCounterRef = useRef(0);
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Scenario #3: dialing countdown. Caller-side only. Starts at 30 when call:start is
  // emitted; the existing 30s timer below still drives the actual leaveCall.
  const [countdown, setCountdown] = useState<number | null>(null);

  // Scenario #6: track candidate types we observed so we can log STUN/TURN reachability.
  const candidateTypesRef = useRef<Set<string>>(new Set());

  // Outgoing ringback tone — played by the caller while waiting for the peer to answer.
  // Stopped as soon as the peer joins the WebRTC room or the call ends.
  const ringbackRef = useRef<CallTone | null>(null);
  const stopRingback = () => {
    ringbackRef.current?.stop();
    ringbackRef.current = null;
  };

  // Scenario #19 (Safari): some browsers won't autoplay remote audio without a user
  // gesture. We arm a one-shot click handler that nudges every remote <audio>/<video>
  // element. Video elements carry audio in video calls so they need the same unlock.
  useEffect(() => {
    const unlock = () => {
      document.querySelectorAll<HTMLAudioElement | HTMLVideoElement>('[data-cyberdeck-remote="true"]').forEach((el) => {
        el.muted = false;
        el.volume = 1.0;
        el.play().catch((err) => console.warn("[CyberDeck:Call] #19 unlock media.play failed:", err));
      });
      console.log("[CyberDeck:Call] #19 user gesture received — remote media unlocked");
    };
    document.addEventListener("click", unlock, { once: true });
    document.addEventListener("touchstart", unlock, { once: true });
    return () => {
      document.removeEventListener("click", unlock);
      document.removeEventListener("touchstart", unlock);
    };
  }, []);

  // (isConnected already pulled from useSocket above — used to drive the
  //  Scenario #9 "Reconnecting to server" banner.)

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  useEffect(() => {
    isPeerConnectedRef.current = isPeerConnected;
  }, [isPeerConnected]);

  // Scenario #12: bail out early on unsupported browsers. We render an error UI instead
  // of attempting WebRTC and crashing. (The buttons that route here are also disabled.)
  useEffect(() => {
    if (!isWebRTCSupported()) {
      setError("Your browser does not support voice/video calls. Please use Chrome, Firefox, or Safari.");
    }
  }, []);

  // Helper to format seconds into MM:SS
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Timer logic: Start counting when peer is connected
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPeerConnected) {
      interval = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPeerConnected]);

  // Sync local video element with stream
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      console.log("[MediaRoom] Syncing local video element");
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, isVideoOff]);

  // Scenarios #5 (mic denied) and #16 (no mic device). Full permission/device error
  // handling: probe devices BEFORE prompting, fall back to audio-only on camera issues,
  // hard-error on mic issues. Never crash.
  const getLocalStream = useCallback(async () => {
    console.log("[CyberDeck:Call] #5/#16 getLocalStream start, wantVideo:", video);
    try {
      if (!window.isSecureContext) {
        showError("generic", "Browser Security Block: Camera/mic access is disabled on non-HTTPS connections. Visit 'chrome://flags/#unsafely-treat-insecure-origin-as-secure' and add your IP.");
        return null;
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showError("browser_unsupported", "This browser does not expose media devices. Please use a modern Chromium/Firefox/Safari build.");
        return null;
      }

      // Scenario #16 — explicit audioinput presence check before getUserMedia. Devices
      // may have empty labels until permission is granted; the kind field is reliable.
      let hasCamera = true;
      let hasMicrophone = true;
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        hasCamera = devices.some((d) => d.kind === "videoinput");
        // If we see ANY audioinput entry (even unlabeled) we treat it as "device exists,
        // permission may be pending". Only if the list is truly empty do we hard-fail.
        const audioinputs = devices.filter((d) => d.kind === "audioinput");
        hasMicrophone = audioinputs.length > 0;
        console.log("[CyberDeck:Call] #16 enumerateDevices: audioinput=", audioinputs.length, "videoinput=", devices.filter(d => d.kind === "videoinput").length);
      } catch (err) {
        console.warn("[CyberDeck:Call] #16 enumerateDevices failed (assuming devices present):", err);
      }

      if (!hasMicrophone) {
        showError("no_mic", "No Microphone Found. Please connect a microphone and try again.");
        return null;
      }

      const wantVideo = !!video && hasCamera;
      if (video && !hasCamera) {
        console.warn("[CyberDeck:Call] #5 video requested but no camera — falling back to audio-only");
        markCameraUnavailable();
      }

      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: wantVideo,
        });
      } catch (err: any) {
        const name = err?.name || "Error";
        console.error("[CyberDeck:Call] #5 getUserMedia failed:", name, err?.message);

        // Camera issues on a video call — try again audio-only.
        if (wantVideo && (name === "NotAllowedError" || name === "NotFoundError" || name === "OverconstrainedError")) {
          console.warn("[CyberDeck:Call] #5 retrying audio-only");
          markCameraUnavailable();
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          } catch (err2: any) {
            const name2 = err2?.name || "Error";
            console.error("[CyberDeck:Call] #5 audio-only retry failed:", name2);
            if (name2 === "NotAllowedError" || name2 === "PermissionDeniedError") {
              showError("mic_denied", "Microphone Access Denied. Please allow microphone access in your browser settings and try again.");
            } else if (name2 === "NotFoundError") {
              showError("no_mic", "No Microphone Found. Please connect a microphone and try again.");
            } else {
              showError("generic", `Could not access microphone (${name2}). Please check your audio device and try again.`);
            }
            return null;
          }
        } else if (name === "NotAllowedError" || name === "PermissionDeniedError") {
          showError("mic_denied", "Microphone Access Denied. Please allow microphone access in your browser settings and try again.");
          return null;
        } else if (name === "NotFoundError") {
          showError("no_mic", "No Microphone Found. Please connect a microphone and try again.");
          return null;
        } else {
          showError("generic", `Could not access media devices (${name}). Please check your audio/video hardware and try again.`);
          return null;
        }
      }

      if (!stream) return null;

      // Scenario #17 — validate the audio track is live & enabled before we use it.
      const audioTracks = stream.getAudioTracks();
      console.log("[CyberDeck:Call] #17 audio tracks:", audioTracks.map(t => ({ enabled: t.enabled, readyState: t.readyState, muted: t.muted })));
      if (audioTracks.length === 0) {
        showError("no_mic", "No audio track was returned by the microphone. Please check your audio device.");
        try { stream.getTracks().forEach(t => t.stop()); } catch { /* noop */ }
        return null;
      }
      audioTracks.forEach((t) => { t.enabled = true; });

      localStreamRef.current = stream;
      setLocalStream(stream);
      return stream;
    } catch (err) {
      console.error("[CyberDeck:Call] #5 unexpected media error:", err);
      showError("generic", "Unexpected error setting up your camera/microphone. Please try again.");
      return null;
    }
  }, [video]);

  // Create peer connection for a remote peer.
  // skipTracks=true is used by the ANSWER side (receiver): tracks are added via addTrack
  // AFTER setRemoteDescription so they match the offer's existing m-sections instead of
  // creating duplicate/orphaned transceivers that never send.
  const createPeerConnection = useCallback((peerId: string, localStream: MediaStream, skipTracks = false) => {
    console.log("[CyberDeck:Call] createPeerConnection peerId:", peerId, "skipTracks:", skipTracks);
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const remoteStream = new MediaStream();

    if (!skipTracks) {
      // Caller side — define the m-sections via addTransceiver before creating the offer.
      // sendrecv ensures the offer advertises both send and receive for each kind.
      const audioTrack = localStream.getAudioTracks()[0];
      const videoTrack = localStream.getVideoTracks()[0];
      try {
        if (audioTrack && audioTrack.readyState === "live") {
          pc.addTransceiver(audioTrack, { direction: "sendrecv", streams: [localStream] });
          console.log("[CyberDeck:Call] #17 added audio transceiver");
        } else {
          console.error("[CyberDeck:Call] #17 audio track missing/dead — call will be silent!", audioTrack);
        }
        if (videoTrack && videoTrack.readyState === "live") {
          pc.addTransceiver(videoTrack, { direction: "sendrecv", streams: [localStream] });
          console.log("[CyberDeck:Call] #17 added video transceiver");
        } else if (video) {
          pc.addTransceiver("video", { direction: "recvonly" });
          console.log("[CyberDeck:Call] #17 added recv-only video transceiver (no local camera)");
        }
      } catch (err) {
        console.warn("[CyberDeck:Call] #17 addTransceiver failed, falling back to addTrack:", err);
        localStream.getTracks().forEach((t) => {
          if (t.readyState === "live") pc.addTrack(t, localStream);
        });
      }

      const audioSenders = pc.getSenders().filter((s) => s.track?.kind === "audio");
      if (audioSenders.length === 0) {
        console.error("[CyberDeck:Call] #17 NO audio sender on PeerConnection — remote will hear silence");
      } else {
        console.log("[CyberDeck:Call] #17 audio senders:", audioSenders.length);
      }
    }

    // Collect remote tracks — always accumulate into our pre-created remoteStream so
    // we handle both cases:
    //   (a) event.streams[0] present  — standard addTransceiver with streams:[...]
    //   (b) event.streams[0] absent   — addTransceiver/addTrack without streams arg
    // We also pull any tracks already in event.streams[0] (other browser may have
    // added multiple tracks to the same stream before our ontrack fires for all).
    // A fresh MediaStream snapshot is created every time so React's useEffect([stream])
    // fires on AudioBridge and RemoteVideo — same-object refs are skipped by React.
    pc.ontrack = (event) => {
      console.log(`[MediaRoom] ontrack: kind=${event.track.kind} streams=${event.streams.length} peerId=${peerId}`);

      // Accumulate the arrived track.
      if (!remoteStream.getTracks().some(t => t.id === event.track.id)) {
        remoteStream.addTrack(event.track);
      }
      // Also absorb any other tracks already in the remote stream bundle.
      if (event.streams.length > 0 && event.streams[0]) {
        event.streams[0].getTracks().forEach(t => {
          if (!remoteStream.getTracks().some(rt => rt.id === t.id)) {
            remoteStream.addTrack(t);
          }
        });
      }

      const snapshot = new MediaStream(remoteStream.getTracks());
      setPeers(prev => {
        const next = new Map(prev);
        next.set(peerId, { pc, remoteStream: snapshot });
        return next;
      });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setIsPeerConnected(true);
      }
    };

    // Scenarios #8 (network drop) and #7 (TURN/ICE failed retry).
    //   disconnected → 10s grace + restartIce (caller drives renegotiation).
    //   connected/completed → clear grace, hide indicator.
    //   failed → first time: surface a Retry button. Second time: terminate with "failed".
    pc.oniceconnectionstatechange = async () => {
      const state = pc.iceConnectionState;
      console.log(`[CyberDeck:Call] #8 iceConnectionState → ${state}`);

      if (state === "connected" || state === "completed") {
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          timersRef.current.delete(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
        setIsReconnecting(false);
        // Clear the failed-state UI if it's still visible (functional setState avoids the
        // stale-closure read).
        setErrorState((prev) => (prev?.kind === "ice_failed" ? null : prev));
        retryAttemptedRef.current = false;
        return;
      }

      if (state === "disconnected") {
        console.log("[CyberDeck:Call] #8 entering reconnect window");
        setIsReconnecting(true);
        if (isInitiator) {
          try {
            const offer = await pc.createOffer({ iceRestart: true });
            await pc.setLocalDescription(offer);
            socket?.emit("webrtc:offer", { targetId: peerId, offer, callId, chatId });
            console.log("[CyberDeck:Call] #8 ICE restart offer sent");
          } catch (err) {
            console.error("[CyberDeck:Call] #8 ICE restart failed:", err);
          }
        }
        if (!reconnectTimerRef.current) {
          reconnectTimerRef.current = trackTimer(setTimeout(() => {
            const finalState = pc.iceConnectionState;
            if (finalState !== "connected" && finalState !== "completed") {
              console.warn("[CyberDeck:Call] #8 recovery window expired — dropping");
              setIsReconnecting(false);
              endCallWithReason("dropped", "Call Dropped: connection lost.");
            }
          }, 10000));
        }
        return;
      }

      if (state === "failed") {
        setIsReconnecting(false);
        if (!retryAttemptedRef.current) {
          // Scenario #7 — give the user a Retry button instead of terminating immediately.
          console.warn("[CyberDeck:Call] #7 ICE failed — offering retry");
          showError("ice_failed", "Connection Failed. Check your network and try again.");
        } else {
          console.warn("[CyberDeck:Call] #7 ICE failed after retry — terminating");
          // status="failed" goes into the server meta via the reason field.
          endCallWithReason("failed", "Unable to Connect.");
        }
      }
    };

    // Scenario #6 — record what kinds of ICE candidates we found locally so we can log
    // STUN reachability when gathering completes. (LAN-only setup has no STUN, so we
    // expect only host candidates; if srflx ever appears, the env has a reachable STUN.)
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const t = event.candidate.type;
        if (t) candidateTypesRef.current.add(t);
        if (socket) {
          socket.emit("webrtc:ice-candidate", {
            targetId: peerId,
            candidate: event.candidate,
            callId,
            chatId,
          });
        }
      }
    };
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === "complete") {
        const types = Array.from(candidateTypesRef.current);
        console.log("[CyberDeck:Call] #6 ICE gathering complete — candidate types:", types);
        if (!candidateTypesRef.current.has("srflx") && !candidateTypesRef.current.has("relay")) {
          console.warn("[CyberDeck:Call] #6 No srflx/relay candidates. LAN-only host candidates in use. (No STUN/TURN configured in iceServers.)");
        }
        if (candidateTypesRef.current.has("relay")) {
          console.log("[CyberDeck:Call] #6 Using TURN relay candidate");
        }
      }
    };

    // Scenario #14 — periodic getStats every 5s. Banner toggles based on thresholds;
    // a sample is written to the CallQualityLog table every 30s (every 6th tick).
    if (!statsIntervalRef.current) {
      statsIntervalRef.current = setInterval(async () => {
        if (peersRef.current.size === 0) return;
        // Take stats from the first peer (1:1 calls). For group calls this becomes
        // a per-peer aggregation later.
        const firstPeer = peersRef.current.values().next().value;
        if (!firstPeer) return;
        try {
          const stats = await firstPeer.pc.getStats();
          let packetsLost = 0;
          let packetsReceived = 0;
          let jitter = 0;
          let rtt = 0;
          stats.forEach((report: any) => {
            if (report.type === "inbound-rtp" && (report.kind === "audio" || report.mediaType === "audio")) {
              packetsLost = report.packetsLost ?? packetsLost;
              packetsReceived = report.packetsReceived ?? packetsReceived;
              jitter = (report.jitter ?? 0) * 1000;
            }
            if (report.type === "candidate-pair" && report.state === "succeeded" && report.nominated) {
              rtt = (report.currentRoundTripTime ?? 0) * 1000;
            }
          });
          const total = packetsLost + packetsReceived;
          const lossPct = total > 0 ? (packetsLost / total) * 100 : 0;
          const weak = lossPct > 10 || rtt > 300 || jitter > 50;
          if (weak) {
            consecutiveNormalChecksRef.current = 0;
            setWeakConnection(true);
          } else {
            consecutiveNormalChecksRef.current += 1;
            if (consecutiveNormalChecksRef.current >= 2) {
              setWeakConnection(false);
            }
          }
          statsLogCounterRef.current += 1;
          if (statsLogCounterRef.current >= 6) {
            statsLogCounterRef.current = 0;
            console.log("[CyberDeck:Call] #14 quality sample:", { lossPct, jitter, rtt });
            if (callId) {
              fetch("/api/call-quality", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  callId,
                  packetLoss: lossPct,
                  jitter,
                  roundTripTime: rtt,
                }),
              }).catch((err) => console.warn("[CyberDeck:Call] #14 quality log post failed:", err));
            }
          }
        } catch (err) {
          console.warn("[CyberDeck:Call] #14 getStats failed:", err);
        }
      }, 5000);
      trackInterval(statsIntervalRef.current);
    }

    // Initialise the candidate queue for this peer (Scenario #11).
    if (!pendingCandidatesRef.current.has(peerId)) {
      pendingCandidatesRef.current.set(peerId, []);
    }

    const peerConn = { pc, remoteStream };
    peersRef.current.set(peerId, peerConn);
    setPeers(prev => new Map(prev).set(peerId, peerConn));

    return pc;
  }, [socket, isInitiator]);

  // Drain ICE candidates that arrived before setRemoteDescription completed (#11).
  const flushPendingCandidates = useCallback(async (peerId: string, pc: RTCPeerConnection) => {
    const queue = pendingCandidatesRef.current.get(peerId);
    if (!queue || queue.length === 0) return;
    pendingCandidatesRef.current.set(peerId, []);
    for (const cand of queue) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch (err) {
        // A failed candidate is non-fatal — log and continue.
        console.warn("[MediaRoom] addIceCandidate (drained) failed:", err);
      }
    }
  }, []);

  // Scenario #8 helper: tear the call down with an explicit reason for the server.
  // Defined before leaveCall (which captures it via ref) so the connection-state callback
  // above can call it.
  const endCallWithReasonRef = useRef<(reason: string, message: string) => void>(() => {});
  const endCallWithReason = (reason: string, message: string) => {
    endCallWithReasonRef.current(reason, message);
  };

  // Leave call. Stable identity (only props/refs read — no mutable state in deps) so the
  // join effect below doesn't tear itself down the instant the peer connects.
  //
  // Scenario #15: this is the single canonical cleanup path. Every termination route
  // (manual end, decline, no-answer, ICE failure, offline/busy, unmount) funnels into
  // leaveCall — which stops tracks, closes peer connections, clears timers/intervals,
  // detaches video/audio elements, and tells the server how the call ended.
  const leaveCall = useCallback((isManual: boolean = true, reason?: string) => {
    if (isEndingRef.current) return;
    isEndingRef.current = true;

    const wasConnected = isPeerConnectedRef.current;

    // Stop ringback immediately on any teardown path.
    stopRingback();

    // Play call-ended chime (only when the call was actually connected).
    if (isPeerConnectedRef.current) {
      playCallEndedSound();
    }

    if (socket && chatId) {
      socket.emit("call:end", { chatId, callId, targetUserId, reason });
      socket.emit("webrtc:leave", chatId);
    }

    // Post a single terminal chat message. Rules to avoid duplicates:
    //  • isManual=true → whoever clicked End Call posts (caller or receiver).
    //    The other side will receive webrtc:peer-left (reason="peer-left") but must NOT post.
    //  • Never connected, isInitiator → caller posts missed/declined/etc.
    //  • Connected + dropped (ICE) → only the initiator posts, so the receiver stays silent.
    const callType = video ? "Video" : "Voice";
    const shouldPost =
      isManual ||                                               // whoever manually ended
      (!wasConnected && isInitiator) ||                        // caller: call never reached receiver
      (wasConnected && isInitiator && reason === "dropped");   // call dropped mid-call — caller reports

    if (shouldPost) {
      let content: string;
      if (wasConnected) {
        content = `📞 ${callType} call ended (${formatDuration(durationRef.current)})`;
      } else {
        const statusText = reason === "declined" ? "declined" : "missed";
        content = `📞 ${callType} call ${statusText}`;
      }
      axios.post(`/api/socket/direct-messages?conversationId=${chatId}`, { content }).catch(() => { });
    }

    // Stop every track on the local stream and detach.
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        try { track.stop(); } catch { /* already stopped */ }
        console.log(`[Media] Stopped track: ${track.kind}`);
      });
      localStreamRef.current = null;
      setLocalStream(null);
    }
    if (localVideoRef.current) {
      try { localVideoRef.current.srcObject = null; } catch { /* noop */ }
    }

    // Close every peer connection and clear its event handlers so the GC can reclaim them.
    peersRef.current.forEach(peer => {
      try {
        peer.pc.ontrack = null;
        peer.pc.onicecandidate = null;
        peer.pc.oniceconnectionstatechange = null;
        peer.pc.onconnectionstatechange = null;
        peer.pc.close();
      } catch { /* noop */ }
    });
    peersRef.current.clear();
    pendingCandidatesRef.current.clear();
    setPeers(new Map());
    setIsJoined(false);

    // Drain every timer/interval we started during this call.
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current.clear();
    intervalsRef.current.forEach((i) => clearInterval(i));
    intervalsRef.current.clear();
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    setIsReconnecting(false);

    // Show ending screen
    setCallEndedState(wasConnected ? "Call Ended" : "Call Disconnected");

    // Strip call params and return to the chat page (not the dashboard)
    const chatUrl = qs.stringifyUrl(
      { url: pathName || "/me", query: { video: undefined, audio: undefined, start: undefined, callId: undefined } },
      { skipNull: true }
    );

    setTimeout(() => {
      router.push(chatUrl);
      router.refresh();

      // Fallback in case router fails (Next.js client-side navigation quirk)
      setTimeout(() => {
        if (isEndingRef.current) {
          window.location.assign(chatUrl);
        }
      }, 1000);
    }, 2000);
  }, [chatId, pathName, router, socket, video, callId, targetUserId, currentProfileName]);

  // Late binding: expose leaveCall to createPeerConnection's ICE-state callback via a ref
  // (the callback was created first; this keeps the dependency graph one-way).
  useEffect(() => {
    endCallWithReasonRef.current = (reason: string, message: string) => {
      // Map terminal-failure reasons to typed error kinds so the overlay renders right.
      const kind: ErrorKind =
        reason === "dropped" ? "ice_dropped"
        : reason === "failed" ? "ice_dropped"
        : "generic";
      showError(kind, message);
      leaveCall(false, reason);
    };
  }, [leaveCall]);

  // Scenario #7 — Retry handler exposed to the failed-state overlay. Calls restartIce()
  // on the surviving peer connection. If this fails too, the next iceConnectionState
  // 'failed' will terminate via endCallWithReason("failed", "Unable to Connect.").
  const onIceRetry = useCallback(async () => {
    if (retryAttemptedRef.current) return;
    console.log("[CyberDeck:Call] #7 user clicked Retry — restartIce");
    retryAttemptedRef.current = true;
    setErrorState(null);
    setIsReconnecting(true);
    for (const [peerId, peer] of peersRef.current.entries()) {
      try {
        peer.pc.restartIce();
        if (isInitiator) {
          const offer = await peer.pc.createOffer({ iceRestart: true });
          await peer.pc.setLocalDescription(offer);
          socket?.emit("webrtc:offer", { targetId: peerId, offer, callId, chatId });
        }
      } catch (err) {
        console.error("[CyberDeck:Call] #7 restartIce failed:", err);
      }
    }
    bumpRender();
  }, [isInitiator, socket]);

  // Scenario #1/#2/#4 — generic auto-dismiss for terminal status overlays. Used by the
  // overlay component to head back to chat after a brief display.
  const autoDismissAndLeave = useCallback((ms: number, reason?: string) => {
    trackTimer(setTimeout(() => leaveCall(false, reason), ms));
  }, [leaveCall]);

  // Scenario #3 — caller-side countdown ticking from 30 → 0 while waiting for an answer.
  // We start it when the call:start signal is emitted (see signalSentRef gate in joinRoom).
  useEffect(() => {
    if (!isInitiator) return;
    if (countdown === null) return;
    if (countdown <= 0) return;
    const i = trackInterval(setInterval(() => {
      setCountdown((c) => (c === null ? null : Math.max(0, c - 1)));
    }, 1000));
    return () => clearInterval(i);
  }, [countdown, isInitiator]);

  // Join the media room
  useEffect(() => {
    if (!socket) return;

    // Track every handler we register so the cleanup can socket.off them BY REFERENCE.
    // A blanket socket.off("event") would clobber listeners registered elsewhere — that was
    // the original "zombie ringtone" bug, and we don't want to reintroduce it.
    const handlers: Record<string, (...args: any[]) => void> = {};
    const isCurrentCallSignal = (data: any) => {
      if (data?.callId && callId) return data.callId === callId;
      return data?.chatId === chatId;
    };

    const joinRoom = async () => {
      // Clear any old connections before joining to prevent duplicate boxes
      peersRef.current.forEach(peer => {
        try { peer.pc.close(); } catch { /* noop */ }
      });
      peersRef.current.clear();
      pendingCandidatesRef.current.clear();
      setPeers(new Map());

      if (isJoined) return;

      // === Call-signaling handlers (caller side mostly) ===

      // Scenario #2 — peer declined our call. Rose-colored overlay for 2s then return.
      handlers["call:decline"] = (data: { chatId?: string; callId?: string }) => {
        if (!isCurrentCallSignal(data)) return;
        console.log("[CyberDeck:Call] #2 call:decline received");
        stopRingback();
        showError("declined", "Call Declined");
        autoDismissAndLeave(1200, "declined");
      };
      socket.on("call:decline", handlers["call:decline"]);

      handlers["call:accept"] = (data: { chatId?: string; callId?: string }) => {
        if (!isCurrentCallSignal(data)) return;
        console.log("[CyberDeck:Call] #2 call:accept received");
        stopRingback();
        setCountdown(null);
      };
      socket.on("call:accept", handlers["call:accept"]);

      // Scenario #1 — server told us the recipient is offline. Gray overlay 3s then return.
      handlers["call:offline"] = (data: any) => {
        if (!isCurrentCallSignal(data)) return;
        console.log("[CyberDeck:Call] #1 call:offline received");
        stopRingback();
        showError("offline", "User is Offline");
        autoDismissAndLeave(3000, "offline");
      };
      socket.on("call:offline", handlers["call:offline"]);

      // Scenario #4 — server (or callee's CallProvider) told us the recipient is busy.
      handlers["call:busy"] = (data: any) => {
        if (!isCurrentCallSignal(data)) return;
        console.log("[CyberDeck:Call] #4 call:busy received");
        stopRingback();
        showError("busy", "Line Busy");
        autoDismissAndLeave(2000, "busy");
      };
      socket.on("call:busy", handlers["call:busy"]);

      // Scenario #10 — peer reported a WebRTC setup failure on their side.
      handlers["webrtc:error"] = (data: any) => {
        console.error("[MediaRoom] Peer reported WebRTC error:", data?.message);
        setError("Something went wrong on the other side. Please try again.");
        trackTimer(setTimeout(() => leaveCall(false, "dropped"), 2000));
      };
      socket.on("webrtc:error", handlers["webrtc:error"]);

      // Scenario #3 — 30-second no-answer timer. Caller-side only. We arm the countdown
      // state here too so the dialing UI shows the live remaining seconds.
      if (isInitiator) {
        setCountdown(30);
      }
      trackTimer(setTimeout(() => {
        if (peersRef.current.size === 0 && !isEndingRef.current && isInitiator) {
          console.log("[CyberDeck:Call] #3 30s no-answer fired");
          stopRingback();
          if (socket && chatId) {
            socket.emit("call:timeout", { chatId, callId, targetUserId });
          }
          showError("no_answer", "No Answer");
          autoDismissAndLeave(2000, "no_answer");
        }
      }, 30000));

      const stream = await getLocalStream();
      if (!stream) return;

      // Apply initial mute/video states immediately without restarting the connection
      stream.getAudioTracks().forEach(t => t.enabled = audio);
      stream.getVideoTracks().forEach(t => t.enabled = video);

      setIsMuted(!audio);
      // If the camera was unavailable, force the local video-off state regardless of prop.
      setIsVideoOff(!video || cameraUnavailableRef.current);

      // === WebRTC signaling handlers ===
      // All SDP calls are wrapped in try/catch (#10). On any failure we notify the peer
      // via webrtc:error, surface a friendly message, and end the call gracefully.

      handlers["webrtc:peer-joined"] = async ({ peerId }: { peerId: string }) => {
        // Peer answered — stop the outgoing ringback immediately.
        stopRingback();
        console.log("[CyberDeck:Call] Peer joined — ringback stopped");
        try {
          const pc = createPeerConnection(peerId, stream);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit("webrtc:offer", { targetId: peerId, offer, callId, chatId });
        } catch (err: any) {
          console.error("[MediaRoom] createOffer/setLocalDescription failed:", err);
          socket.emit("webrtc:error", { targetId: peerId, message: String(err?.message || err), callId, chatId });
          endCallWithReason("dropped", "Something went wrong setting up the call. Please try again.");
        }
      };
      socket.on("webrtc:peer-joined", handlers["webrtc:peer-joined"]);

      handlers["webrtc:offer"] = async ({ peerId, offer }: { peerId: string; offer: RTCSessionDescriptionInit }) => {
        try {
          // skipTracks=true: no transceivers created before the offer is applied.
          const pc = createPeerConnection(peerId, stream, true);
          await pc.setRemoteDescription(new RTCSessionDescription(offer));

          // Wire local tracks to the offer's transceivers using replaceTrack, which
          // targets each transceiver directly instead of relying on addTrack's implicit
          // matching. This guarantees both audio and video are wired correctly across
          // all browser implementations.
          for (const transceiver of pc.getTransceivers()) {
            const kind = transceiver.receiver.track?.kind;
            if (!kind) continue;
            const localTrack = stream.getTracks().find(
              (t) => t.kind === kind && t.readyState === "live"
            );
            if (localTrack) {
              await transceiver.sender.replaceTrack(localTrack);
              transceiver.direction = "sendrecv";
              console.log(`[CyberDeck:Call] #17 receiver wired ${kind} track via replaceTrack`);
            }
          }

          // Drain any candidates that arrived before remote description was set (#11).
          await flushPendingCandidates(peerId, pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit("webrtc:answer", { targetId: peerId, answer, callId, chatId });
        } catch (err: any) {
          console.error("[MediaRoom] handle offer failed:", err);
          socket.emit("webrtc:error", { targetId: peerId, message: String(err?.message || err), callId, chatId });
          endCallWithReason("dropped", "Something went wrong setting up the call. Please try again.");
        }
      };
      socket.on("webrtc:offer", handlers["webrtc:offer"]);

      handlers["webrtc:answer"] = async ({ peerId, answer }: { peerId: string; answer: RTCSessionDescriptionInit }) => {
        const peer = peersRef.current.get(peerId);
        if (!peer) return;
        try {
          await peer.pc.setRemoteDescription(new RTCSessionDescription(answer));
          await flushPendingCandidates(peerId, peer.pc);
        } catch (err: any) {
          console.error("[MediaRoom] setRemoteDescription(answer) failed:", err);
          socket.emit("webrtc:error", { targetId: peerId, message: String(err?.message || err), callId, chatId });
          endCallWithReason("dropped", "Something went wrong setting up the call. Please try again.");
        }
      };
      socket.on("webrtc:answer", handlers["webrtc:answer"]);

      // Scenario #11: if the PC isn't ready or its remoteDescription is still null,
      // queue the candidate instead of crashing. Some candidate failures are normal
      // and should not abort the call.
      handlers["webrtc:ice-candidate"] = async ({ peerId, candidate }: { peerId: string; candidate: RTCIceCandidateInit }) => {
        const peer = peersRef.current.get(peerId);
        if (!peer || !peer.pc.remoteDescription) {
          const q = pendingCandidatesRef.current.get(peerId) ?? [];
          q.push(candidate);
          pendingCandidatesRef.current.set(peerId, q);
          return;
        }
        try {
          await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.warn("[MediaRoom] addIceCandidate failed (non-fatal):", err);
        }
      };
      socket.on("webrtc:ice-candidate", handlers["webrtc:ice-candidate"]);

      handlers["webrtc:peer-left"] = ({ peerId }: { peerId: string }) => {
        console.log(`[MediaRoom] Peer left: ${peerId}`);
        const peer = peersRef.current.get(peerId);
        if (!peer) return;
        try {
          peer.pc.ontrack = null;
          peer.pc.onicecandidate = null;
          peer.pc.oniceconnectionstatechange = null;
          peer.pc.onconnectionstatechange = null;
          peer.pc.close();
        } catch { /* noop */ }
        peersRef.current.delete(peerId);
        pendingCandidatesRef.current.delete(peerId);
        setPeers(prev => {
          const next = new Map(prev);
          next.delete(peerId);
          if (next.size === 0) {
            console.log("[MediaRoom] No peers left. Hanging up in 1.5s...");
            trackTimer(setTimeout(() => leaveCall(false, "peer-left"), 1500));
          }
          return next;
        });
      };
      socket.on("webrtc:peer-left", handlers["webrtc:peer-left"]);

      // Join the signaling room
      socket.emit("webrtc:join", { roomId: chatId, callId, isInitiator });
      setIsJoined(true);

      // If we are starting this call, notify the other peer
      if (isInitiator && !signalSentRef.current) {
        signalSentRef.current = true;
        console.log(`[CyberDeck:Call] #1 emit call:start, callId:`, callId, "target:", targetUserId);
        socket.emit("call:start", {
          chatId,
          callId,
          callerName: currentProfileName || "Someone",
          type: video ? "video" : "audio",
          serverId,
          callerMemberId,
          callerUserId,
          targetUserId,
          cameraUnavailable: cameraUnavailableRef.current,
        });

        // Start outgoing ringback so the caller hears ringing while waiting.
        if (!ringbackRef.current) {
          ringbackRef.current = new CallTone();
        }
        ringbackRef.current.play();
        console.log("[CyberDeck:Call] Outgoing ringback started");
      }
    };

    joinRoom();

    return () => {
      stopRingback();

      if (socket && chatId) {
        socket.emit("webrtc:leave", chatId);
        if (!isEndingRef.current) {
          socket.emit("call:end", { chatId, callId, targetUserId });
        }
      }

      // Scenario #15: remove ONLY our handlers, by reference.
      Object.entries(handlers).forEach(([event, handler]) => {
        try { socket.off(event, handler); } catch { /* noop */ }
      });

      peersRef.current.forEach(peer => {
        try {
          peer.pc.ontrack = null;
          peer.pc.onicecandidate = null;
          peer.pc.oniceconnectionstatechange = null;
          peer.pc.onconnectionstatechange = null;
          peer.pc.close();
        } catch { /* noop */ }
      });
      peersRef.current.clear();
      pendingCandidatesRef.current.clear();

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          try { track.stop(); } catch { /* noop */ }
        });
        localStreamRef.current = null;
      }
      if (localVideoRef.current) {
        try { localVideoRef.current.srcObject = null; } catch { /* noop */ }
      }

      timersRef.current.forEach((t) => clearTimeout(t));
      timersRef.current.clear();
      intervalsRef.current.forEach((i) => clearInterval(i));
      intervalsRef.current.clear();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
    // Intentionally omit getLocalStream / createPeerConnection / leaveCall — they're stable
    // for the lifetime of this mount, and including them caused the effect to tear down the
    // call the moment the peer connected (isPeerConnected → leaveCall identity change).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, chatId]);

  // Toggle mute
  const toggleMute = () => {
    if (!localStreamRef.current) return;

    const newMutedState = !isMuted;
    localStreamRef.current.getAudioTracks().forEach(t => {
      t.enabled = !newMutedState;
    });
    setIsMuted(newMutedState);
  };

  // Toggle video
  const toggleVideo = () => {
    if (!localStreamRef.current) return;

    const newVideoOffState = !isVideoOff;
    localStreamRef.current.getVideoTracks().forEach(t => {
      t.enabled = !newVideoOffState;
    });
    setIsVideoOff(newVideoOffState);
  };



  if (callEndedState) {
    const returnToChat = () => {
      const url = qs.stringifyUrl(
        { url: pathName || "/", query: { video: undefined, audio: undefined, start: undefined, callId: undefined } },
        { skipNull: true }
      );
      window.location.assign(url);
    };
    return (
      // Tap anywhere on the screen to return to chat
      <div
        className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black/90 backdrop-blur-3xl animate-in fade-in duration-500 cursor-pointer select-none"
        onClick={returnToChat}
      >
        {/* Tap hint at top */}
        <p className="absolute top-6 left-0 right-0 text-center text-zinc-600 text-[11px] font-mono uppercase tracking-widest">
          Tap anywhere to return to chat
        </p>
        <div className="flex flex-col items-center space-y-6 animate-in zoom-in-50 duration-700">
          <div className="h-24 w-24 rounded-full bg-rose-500/20 border border-rose-500 flex items-center justify-center shadow-[0_0_50px_rgba(244,63,94,0.4)]">
            <PhoneOff className="h-10 w-10 text-rose-500" />
          </div>
          <div className="flex flex-col items-center space-y-2">
            <h2 className="text-4xl font-black text-white tracking-tight drop-shadow-md">{callEndedState}</h2>
            {duration > 0 && <p className="text-emerald-500 font-mono text-xl uppercase tracking-widest">Duration: {formatDuration(duration)}</p>}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); returnToChat(); }}
            className="mt-4 px-8 py-3 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-bold transition-all shadow-lg active:scale-95 border border-zinc-700"
          >
            Return to Chat
          </button>
        </div>
      </div>
    );
  }

  if (errorState) {
    // Scenarios #1 / #2 / #3 / #4 / #5 / #7 / #12 — branded full-screen overlay tuned per kind.
    const { kind, message } = errorState;
    const palette =
      kind === "offline" ? { ring: "border-zinc-500/40", glow: "bg-zinc-500/10", icon: "text-zinc-400", title: "text-zinc-300", titleText: "User is Offline", initialBg: "bg-zinc-700" }
      : kind === "declined" ? { ring: "border-rose-500/40", glow: "bg-rose-500/10", icon: "text-rose-400", title: "text-rose-400", titleText: "Call Declined", initialBg: "bg-zinc-800" }
      : kind === "busy" ? { ring: "border-amber-500/40", glow: "bg-amber-500/10", icon: "text-amber-400", title: "text-amber-400", titleText: "User is Busy", initialBg: "bg-zinc-800" }
      : kind === "no_answer" ? { ring: "border-indigo-500/40", glow: "bg-indigo-500/10", icon: "text-indigo-300", title: "text-indigo-300", titleText: "No Answer", initialBg: "bg-zinc-800" }
      : kind === "mic_denied" ? { ring: "border-rose-500/40", glow: "bg-rose-500/10", icon: "text-rose-400", title: "text-rose-400", titleText: "Microphone Access Denied", initialBg: "bg-zinc-800" }
      : kind === "no_mic" ? { ring: "border-rose-500/40", glow: "bg-rose-500/10", icon: "text-rose-400", title: "text-rose-400", titleText: "No Microphone Found", initialBg: "bg-zinc-800" }
      : kind === "ice_failed" ? { ring: "border-amber-500/40", glow: "bg-amber-500/10", icon: "text-amber-400", title: "text-amber-400", titleText: "Connection Failed", initialBg: "bg-zinc-800" }
      : kind === "ice_dropped" ? { ring: "border-rose-500/40", glow: "bg-rose-500/10", icon: "text-rose-400", title: "text-rose-400", titleText: "Unable to Connect", initialBg: "bg-zinc-800" }
      : kind === "browser_unsupported" ? { ring: "border-rose-500/40", glow: "bg-rose-500/10", icon: "text-rose-400", title: "text-rose-400", titleText: "Browser Not Supported", initialBg: "bg-zinc-800" }
      : { ring: "border-rose-500/30", glow: "bg-rose-500/10", icon: "text-rose-400", title: "text-rose-500", titleText: "Connection Failed", initialBg: "bg-zinc-800" };

    const showRetry = kind === "ice_failed";
    const showOpenSettings = kind === "mic_denied";

    const dismissError = () => leaveCall(false);
    return (
      // Tap anywhere to dismiss and return to chat (except on Retry/Settings buttons)
      <div
        className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-zinc-900 to-black overflow-hidden cursor-pointer select-none"
        onClick={dismissError}
      >
        {/* Tap hint */}
        <p className="absolute top-6 left-0 right-0 text-center text-zinc-600 text-[11px] font-mono uppercase tracking-widest">
          Tap anywhere to return to chat
        </p>
        <div
          className="relative flex flex-col items-center justify-center z-10 animate-in fade-in duration-500"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="relative flex items-center justify-center mb-8">
            <div className="absolute inset-0 h-48 w-48 -m-12 rounded-full border " />
            <div className={cn("absolute inset-0 h-48 w-48 -m-12 rounded-full border", palette.ring)} />
            <div className={cn("absolute inset-0 h-48 w-48 -m-12 rounded-full", palette.glow)} />

            {/* Avatar — grayscale for offline, full color otherwise */}
            <div className={cn(
              "relative z-10 h-32 w-32 rounded-full border-4 flex items-center justify-center overflow-hidden shadow-2xl",
              palette.initialBg,
              kind === "offline" ? "border-zinc-500/50 grayscale" : "border-rose-500/50"
            )}>
              {peerImageUrl ? (
                <img src={peerImageUrl} alt="Peer" className="object-cover w-full h-full" />
              ) : (
                <span className="text-4xl font-black text-white/50 uppercase">
                  {peerName ? peerName.charAt(0) : (chatId.charAt(0) || "?")}
                </span>
              )}
            </div>

            {/* Status icon badge */}
            <div className={cn(
              "absolute -bottom-2 right-0 z-20 h-10 w-10 rounded-full border-2 border-black flex items-center justify-center shadow-lg",
              kind === "offline" ? "bg-zinc-700"
              : kind === "busy" ? "bg-amber-500"
              : kind === "no_answer" ? "bg-indigo-500"
              : "bg-rose-500"
            )}>
              <PhoneOff className={cn("h-5 w-5 text-white", kind === "declined" && "rotate-[135deg]")} />
            </div>
          </div>

          <h2 className={cn("text-3xl font-black tracking-tight drop-shadow-md mb-2", palette.title)}>
            {palette.titleText}
          </h2>
          <p className="text-zinc-400 text-sm font-mono max-w-sm text-center mb-10 px-6">
            {message}
          </p>

          <div className="flex items-center gap-x-4 flex-wrap justify-center">
            {showRetry && (
              <button
                onClick={(e) => { e.stopPropagation(); onIceRetry(); }}
                className="px-8 py-3 rounded-full bg-amber-500 text-black font-bold text-sm hover:bg-amber-400 transition-all duration-300"
              >
                Retry
              </button>
            )}
            {showOpenSettings && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  window.alert(
                    "Chrome / Edge: click the padlock icon in the address bar, set Microphone to Allow.\n" +
                    "Firefox: click the icon to the left of the address bar, allow microphone.\n" +
                    "Safari: Safari → Settings for This Website → set Microphone to Allow."
                  );
                }}
                className="px-8 py-3 rounded-full bg-rose-500 text-white font-bold text-sm hover:bg-rose-400 transition-all duration-300"
              >
                Open Settings
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); dismissError(); }}
              className="px-8 py-3 rounded-full bg-zinc-800 text-zinc-300 font-bold text-sm hover:bg-zinc-700 transition-all duration-300"
            >
              Return to Chat
            </button>
          </div>
        </div>
      </div>
    );
  }



  // Scenarios #9 / #14 — shared global banners pinned at the top of every in-call screen.
  const SignalBanners = () => (
    <>
      {!isConnected && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-rose-500/90 text-white text-xs font-mono font-bold tracking-widest uppercase shadow-lg flex items-center gap-x-2 animate-pulse">
          <Loader2 className="h-4 w-4 animate-spin" />
          Reconnecting to server…
        </div>
      )}
      {isConnected && weakConnection && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-amber-500/90 text-black text-xs font-mono font-bold tracking-widest uppercase shadow-lg">
          Weak Connection
        </div>
      )}
    </>
  );

  if (!isJoined) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-indigo-900/40 to-black overflow-hidden">
        <SignalBanners />
        {/* Top Progress Bar */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-black overflow-hidden">
          <div className="h-full bg-indigo-500 animate-[pulse_1s_ease-in-out_infinite] w-full" style={{ transformOrigin: 'left', animation: 'progress 2s ease-in-out infinite alternate' }} />
        </div>

        <div className="relative flex flex-col items-center justify-center z-10 flex-1">
          
          <div className="relative flex items-center justify-center mb-10 mt-16">
            {/* Fast pulsing rings */}
            <div className="absolute inset-0 h-48 w-48 -m-12 rounded-full border-2 border-indigo-500/60 animate-[ping_1.5s_cubic-bezier(0,0,0.2,1)_infinite]" />
            <div className="absolute inset-0 h-48 w-48 -m-12 rounded-full border border-purple-500/40 animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite_0.5s]" />
            <div className="absolute inset-0 h-48 w-48 -m-12 rounded-full bg-indigo-500/20 animate-pulse duration-500" />
            
            {/* Avatar */}
            <div className="relative z-10 h-32 w-32 rounded-full bg-zinc-800 border-4 border-indigo-400 shadow-[0_0_50px_rgba(99,102,241,0.8)] flex items-center justify-center overflow-hidden">
              {peerImageUrl ? (
                <img src={peerImageUrl} alt="Peer" className="object-cover w-full h-full" />
              ) : (
                <span className="text-4xl font-black text-white uppercase">
                  {peerName ? peerName.charAt(0) : (chatId.charAt(0) || "?")}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-x-2 text-indigo-400 mb-2">
            <svg className="w-5 h-5 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <span className="text-sm font-mono uppercase tracking-[0.2em] font-bold">
              Securing Connection
            </span>
          </div>

          {/* Scenario #3 — dialing countdown */}
          {isInitiator && countdown !== null && countdown > 0 && (
            <div className="text-zinc-400 text-xs font-mono uppercase tracking-[0.3em] mb-8">
              Auto-end in {countdown}s
            </div>
          )}
        </div>

        {/* Bottom End Call Button */}
        <div className="h-32 flex items-center justify-center pb-8 z-20 w-full">
          <button
            onClick={() => leaveCall(true)}
            className="h-16 w-16 rounded-full bg-rose-500 hover:bg-rose-600 flex items-center justify-center transition-all duration-300 shadow-[0_0_20px_rgba(244,63,94,0.4)] hover:shadow-[0_0_30px_rgba(244,63,94,0.6)] active:scale-95"
          >
            <PhoneOff className="h-8 w-8 text-white rotate-[135deg]" />
          </button>
        </div>
      </div>
    );
  }

  // ACTIVE VOICE CALL SCREEN
  if (!video) {
    const isConnectedToPeer = peers.size > 0;
    return (
      <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-[#0d0f14]">

        {/* Ambient background — subtle blurred peer image if available */}
        {peerImageUrl && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <img src={peerImageUrl} alt="" aria-hidden
              className="absolute inset-0 w-full h-full object-cover scale-150 blur-[100px] opacity-[0.07]" />
          </div>
        )}
        {/* Soft emerald radial glow when connected */}
        {isConnectedToPeer && (
          <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_60%_50%_at_50%_40%,rgba(52,211,153,0.05)_0%,transparent_70%)]" />
        )}

        {/* ── TOP STATUS ROW ── */}
        <div className="relative z-20 flex items-center justify-between px-5 pt-5">
          {/* Back to chat button — always visible top-left */}
          <div className="flex items-center gap-x-2">
            <button
              onClick={() => leaveCall(true)}
              aria-label="Return to chat"
              className="flex items-center gap-x-1.5 bg-white/8 border border-white/10 text-zinc-300 text-[11px] font-mono font-bold uppercase tracking-widest px-3 py-1.5 rounded-full hover:bg-white/15 active:scale-95 transition-all"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Chat
            </button>
            {!isConnected && (
              <div className="flex items-center gap-x-1.5 bg-rose-500/20 border border-rose-500/30 text-rose-400 text-[10px] font-mono font-bold uppercase tracking-widest px-3 py-1.5 rounded-full animate-pulse">
                <Loader2 className="h-3 w-3 animate-spin" /> No server
              </div>
            )}
            {isReconnecting && (
              <div className="flex items-center gap-x-1.5 bg-amber-500/20 border border-amber-500/30 text-amber-400 text-[10px] font-mono font-bold uppercase tracking-widest px-3 py-1.5 rounded-full animate-pulse">
                <Loader2 className="h-3 w-3 animate-spin" /> Reconnecting
              </div>
            )}
            {isConnected && weakConnection && !isReconnecting && (
              <div className="bg-amber-500/20 border border-amber-500/30 text-amber-400 text-[10px] font-mono font-bold uppercase tracking-widest px-3 py-1.5 rounded-full">
                Weak Signal
              </div>
            )}
          </div>
          <div className="flex items-center gap-x-1.5 bg-white/5 border border-white/10 text-emerald-400 text-[10px] font-mono font-bold uppercase tracking-widest px-3 py-1.5 rounded-full">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />E2E Encrypted
          </div>
        </div>

        {/* ── HERO CENTER ── */}
        <div className="flex-1 flex flex-col items-center justify-center relative z-10 px-8 -mt-4">

          {/* Avatar with animated rings */}
          <div className="relative flex items-center justify-center mb-8">
            {/* Outer glow blob */}
            <div className={cn(
              "absolute w-80 h-80 rounded-full transition-opacity duration-1000",
              isConnectedToPeer
                ? "bg-emerald-500/10 blur-3xl opacity-100"
                : "bg-white/5 blur-3xl opacity-60"
            )} />

            {/* Animated ping rings */}
            <div className={cn(
              "absolute w-72 h-72 rounded-full border transition-colors duration-700",
              isConnectedToPeer ? "border-emerald-500/20" : "border-white/8",
              "animate-[ping_3.5s_ease-in-out_infinite]"
            )} />
            <div className={cn(
              "absolute w-56 h-56 rounded-full border transition-colors duration-700",
              isConnectedToPeer ? "border-emerald-500/25" : "border-white/6",
              "animate-[ping_3s_ease-in-out_infinite_0.7s]"
            )} />

            {/* Solid inner ring */}
            <div className={cn(
              "absolute w-52 h-52 rounded-full border-2 transition-all duration-700",
              isConnectedToPeer
                ? "border-emerald-500/30 shadow-[0_0_40px_rgba(52,211,153,0.15)]"
                : "border-white/5"
            )} />

            {/* Avatar */}
            <div className={cn(
              "relative w-44 h-44 rounded-full overflow-hidden border-4 z-10 shadow-2xl transition-all duration-700",
              isConnectedToPeer
                ? "border-emerald-400/60 shadow-[0_0_80px_rgba(52,211,153,0.3),0_0_140px_rgba(52,211,153,0.1)]"
                : "border-white/10 shadow-[0_30px_80px_rgba(0,0,0,0.6)]"
            )}>
              {peerImageUrl ? (
                <img src={peerImageUrl} alt="Peer" className="object-cover w-full h-full" />
              ) : (
                <div className="w-full h-full bg-zinc-800 flex items-center justify-center">
                  <span className="text-6xl font-black text-zinc-300 uppercase">
                    {peerName ? peerName.charAt(0) : "?"}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Name */}
          <h2 className="text-4xl font-bold text-white tracking-tight mb-3 text-center truncate max-w-xs">
            {peerName || "Unknown"}
          </h2>

          {/* Status + duration on same line */}
          <div className="flex items-center gap-x-3 mb-6">
            <span className={cn(
              "text-sm font-medium tracking-wide",
              isConnectedToPeer ? "text-emerald-400" : "text-zinc-400 animate-pulse"
            )}>
              {isConnectedToPeer ? "Connected" : "Calling…"}
            </span>
            {isConnectedToPeer && (
              <>
                <span className="text-zinc-700">·</span>
                <span className="text-zinc-400 font-mono text-sm tabular-nums">
                  {formatDuration(duration)}
                </span>
              </>
            )}
          </div>

          {/* Self indicator — small floating chip */}
          <div className="flex items-center gap-x-2 bg-white/5 border border-white/10 px-3 py-1.5 rounded-full">
            <div className="h-6 w-6 rounded-full bg-zinc-700 flex items-center justify-center text-[11px] font-black text-zinc-300 uppercase">
              {(currentProfileName || "Y").charAt(0)}
            </div>
            <span className="text-zinc-400 text-xs font-medium">{currentProfileName || "You"}</span>
            {isMuted && <MicOff className="h-3.5 w-3.5 text-rose-400" />}
          </div>
        </div>

        {/* ── BOTTOM CONTROLS — glass pill ── */}
        <div className="relative z-20 flex justify-center px-6 pb-10 pt-4">
          <div className="flex items-center gap-x-2 px-4 py-3 bg-white/5 backdrop-blur-2xl rounded-2xl border border-white/10 shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
            {/* Mute */}
            <button
              onClick={toggleMute}
              aria-label={isMuted ? "Unmute" : "Mute"}
              className={cn(
                "h-12 w-12 rounded-xl flex items-center justify-center transition-all duration-200 active:scale-90",
                isMuted
                  ? "bg-rose-500/25 text-rose-400 ring-1 ring-rose-500/50"
                  : "bg-white/10 text-white hover:bg-white/15"
              )}
            >
              {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </button>

            {/* Speaker */}
            <button
              aria-label="Speaker"
              className="h-12 w-12 rounded-xl bg-white/10 text-white hover:bg-white/15 flex items-center justify-center transition-all duration-200 active:scale-90"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5 10v4a2 2 0 002 2h2.586l3.707 3.707A.996.996 0 0015 19V5a.996.996 0 00-1.707-.707L9.586 8H7a2 2 0 00-2 2z" />
              </svg>
            </button>

            <div className="w-px h-8 bg-white/10 mx-1" />

            {/* End call */}
            <button
              onClick={() => leaveCall(true)}
              aria-label="End call"
              className="h-12 px-7 rounded-xl bg-rose-600 hover:bg-rose-500 flex items-center justify-center gap-x-2 transition-all duration-200 active:scale-95 shadow-lg shadow-rose-900/40"
            >
              <PhoneOff className="h-5 w-5 text-white rotate-[135deg]" />
              <span className="text-white text-sm font-semibold">End Call</span>
            </button>

            <div className="w-px h-8 bg-white/10 mx-1" />

            {/* More */}
            <button
              aria-label="More options"
              className="h-12 w-12 rounded-xl bg-white/10 text-white hover:bg-white/15 flex items-center justify-center transition-all duration-200 active:scale-90"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Audio Bridge */}
        {Array.from(peers.entries()).map(([peerId, { remoteStream }]) => (
          <AudioBridge key={peerId} stream={remoteStream} peerId={peerId} />
        ))}
      </div>
    );
  }

  // ACTIVE VIDEO CALL SCREEN — immersive edge-to-edge
  const hasPeers = peers.size > 0;
  const firstPeer = hasPeers ? Array.from(peers.values())[0] : null;

  return (
    <div className="fixed inset-0 z-50 bg-black overflow-hidden">

      {/* ── FULL-BLEED REMOTE VIDEO ── */}
      {hasPeers && firstPeer ? (
        <div className="absolute inset-0">
          <RemoteVideo stream={firstPeer.remoteStream} isHero peerName={peerName} peerImageUrl={peerImageUrl} />
        </div>
      ) : (
        /* Pre-connect waiting state */
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[radial-gradient(ellipse_at_center,#1a1c23_0%,#0a0b0d_100%)]">
          <div className="relative flex flex-col items-center gap-5">
            <div className="relative flex items-center justify-center">
              <div className="absolute w-56 h-56 rounded-full border border-indigo-500/15 animate-[ping_3s_ease-in-out_infinite]" />
              <div className="absolute w-44 h-44 rounded-full border border-indigo-500/10 animate-[ping_3.5s_ease-in-out_infinite_0.6s]" />
              <div className="absolute w-52 h-52 rounded-full bg-indigo-500/5 blur-2xl" />
              <div className="relative h-36 w-36 rounded-full bg-zinc-800/80 border-2 border-white/10 flex items-center justify-center overflow-hidden shadow-2xl z-10">
                {peerImageUrl ? (
                  <img src={peerImageUrl} alt="Peer" className="object-cover w-full h-full" />
                ) : (
                  <span className="text-6xl font-black text-zinc-300 uppercase">{peerName ? peerName.charAt(0) : "?"}</span>
                )}
              </div>
            </div>
            <div className="flex flex-col items-center gap-1">
              <span className="text-white font-semibold text-xl">{peerName || "Peer"}</span>
              <div className="flex items-center gap-1.5 text-zinc-400 text-xs font-mono uppercase tracking-widest">
                <Loader2 className="h-3 w-3 animate-spin" />
                Calling…
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── GRADIENT SCRIM — top ── */}
      <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/75 via-black/30 to-transparent pointer-events-none z-10" />

      {/* ── GRADIENT SCRIM — bottom ── */}
      <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/85 via-black/45 to-transparent pointer-events-none z-10" />

      {/* ── TOP LEFT: back button + status badges ── */}
      <div className="absolute top-4 left-4 z-20 flex items-center gap-x-2">
        {/* Back to chat — always visible */}
        <button
          onClick={() => leaveCall(true)}
          aria-label="Return to chat"
          className="flex items-center gap-x-1.5 bg-black/50 backdrop-blur-xl border border-white/10 text-zinc-300 text-[11px] font-mono font-bold uppercase tracking-widest px-3 py-1.5 rounded-full hover:bg-black/70 active:scale-95 transition-all shadow-lg"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Chat
        </button>
        {!isConnected && (
          <div className="flex items-center gap-x-1.5 bg-rose-500/20 border border-rose-500/30 text-rose-400 text-[10px] font-mono font-bold uppercase tracking-widest px-3 py-1.5 rounded-full animate-pulse backdrop-blur-md">
            <Loader2 className="h-3 w-3 animate-spin" /> No server
          </div>
        )}
        {isReconnecting && (
          <div className="flex items-center gap-x-1.5 bg-amber-500/20 border border-amber-500/30 text-amber-400 text-[10px] font-mono font-bold uppercase tracking-widest px-3 py-1.5 rounded-full animate-pulse backdrop-blur-md">
            <Loader2 className="h-3 w-3 animate-spin" /> Reconnecting
          </div>
        )}
        {isConnected && weakConnection && !isReconnecting && (
          <div className="bg-amber-500/20 border border-amber-500/30 text-amber-400 text-[10px] font-mono font-bold uppercase tracking-widest px-3 py-1.5 rounded-full backdrop-blur-md">
            Weak Signal
          </div>
        )}
      </div>

      {/* ── TOP CENTER: peer info pill ── */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-x-2.5 bg-black/50 backdrop-blur-xl border border-white/10 rounded-2xl px-4 py-2 shadow-xl whitespace-nowrap">
        <div className={cn(
          "h-2 w-2 rounded-full flex-none transition-colors duration-500",
          hasPeers ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" : "bg-zinc-500 animate-pulse"
        )} />
        <span className="text-white text-sm font-semibold truncate max-w-[16ch]">{peerName || "Video Call"}</span>
        {hasPeers && (
          <>
            <span className="text-white/25">·</span>
            <span className="text-zinc-300 font-mono text-xs tabular-nums">{formatDuration(duration)}</span>
          </>
        )}
      </div>

      {/* ── TOP RIGHT: E2E badge ── */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-x-1.5 bg-black/40 backdrop-blur-xl border border-emerald-500/20 text-emerald-400 text-[10px] font-mono font-bold uppercase tracking-widest px-3 py-1.5 rounded-full">
        <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />E2E
      </div>

      {/* ── SELF-VIEW PiP — above control bar ── */}
      <div className="absolute bottom-24 right-4 z-20 group">
        <div className="relative w-32 h-24 md:w-40 md:h-28 rounded-2xl overflow-hidden bg-zinc-900 ring-2 ring-white/15 shadow-[0_8px_32px_rgba(0,0,0,0.8)] transition-all duration-200 group-hover:ring-white/30 group-hover:scale-[1.03]">
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            className={cn("w-full h-full object-cover scale-x-[-1]", isVideoOff && "hidden")}
          />
          {isVideoOff && (
            <div className="absolute inset-0 flex items-center justify-center bg-zinc-900">
              <div className="h-10 w-10 rounded-full bg-zinc-700 flex items-center justify-center text-sm font-black text-zinc-300 uppercase">
                {(currentProfileName || "Y").charAt(0)}
              </div>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
          <div className="absolute bottom-1.5 left-2 right-2 flex items-center justify-between pointer-events-none">
            <span className="text-white text-[10px] font-semibold drop-shadow">You</span>
            {isMuted && (
              <div className="h-4 w-4 rounded-full bg-rose-500 flex items-center justify-center shadow">
                <MicOff className="h-2.5 w-2.5 text-white" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── FLOATING GLASS PILL CONTROL BAR ── */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-x-2 px-4 py-3 bg-black/70 backdrop-blur-2xl rounded-2xl border border-white/10 shadow-[0_20px_60px_rgba(0,0,0,0.7)]">

        {/* Mute */}
        <button
          onClick={toggleMute}
          aria-label={isMuted ? "Unmute" : "Mute"}
          className={cn(
            "h-11 w-11 rounded-xl flex items-center justify-center transition-all duration-200 active:scale-90",
            isMuted
              ? "bg-rose-500/25 text-rose-400 ring-1 ring-rose-500/50"
              : "bg-white/10 text-white hover:bg-white/20"
          )}
        >
          {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </button>

        {/* Camera */}
        <button
          onClick={toggleVideo}
          aria-label={isVideoOff ? "Turn camera on" : "Turn camera off"}
          className={cn(
            "h-11 w-11 rounded-xl flex items-center justify-center transition-all duration-200 active:scale-90",
            isVideoOff
              ? "bg-rose-500/25 text-rose-400 ring-1 ring-rose-500/50"
              : "bg-white/10 text-white hover:bg-white/20"
          )}
        >
          {isVideoOff ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
        </button>

        {/* Screen share placeholder */}
        <button
          aria-label="Share screen"
          className="h-11 w-11 rounded-xl bg-white/10 text-white hover:bg-white/20 flex items-center justify-center transition-all duration-200 active:scale-90"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </button>

        <div className="w-px h-8 bg-white/15 mx-1" />

        {/* End call */}
        <button
          onClick={() => leaveCall(true)}
          aria-label="End call"
          className="h-11 px-6 rounded-xl bg-rose-600 hover:bg-rose-500 flex items-center justify-center gap-x-2 transition-all duration-200 active:scale-95 shadow-lg shadow-rose-900/50"
        >
          <PhoneOff className="h-5 w-5 text-white rotate-[135deg]" />
          <span className="text-white text-sm font-semibold">End Call</span>
        </button>

        <div className="w-px h-8 bg-white/15 mx-1" />

        {/* More */}
        <button
          aria-label="More options"
          className="h-11 w-11 rounded-xl bg-white/10 text-white hover:bg-white/20 flex items-center justify-center transition-all duration-200 active:scale-90"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />
          </svg>
        </button>
      </div>

      {/* Audio bridge — hidden audio elements that play remote audio tracks.
          RemoteVideo's <video> element handles video display; keeping audio
          in a dedicated <audio> element is more reliable across browsers. */}
      {Array.from(peers.entries()).map(([peerId, { remoteStream }]) => (
        <AudioBridge key={peerId} stream={remoteStream} peerId={peerId} />
      ))}
    </div>
  );
}

// Stable audio bridge — useEffect([stream]) means srcObject/play() only fire when the
// stream reference changes (new ontrack event), never on unrelated parent re-renders
// such as setIsMuted. This is the fix for the "mute makes remote audio stop" bug.
function AudioBridge({ stream, peerId }: { stream: MediaStream; peerId: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !stream) return;

    console.log("[CyberDeck:Call] #18 AudioBridge attach. Tracks:", stream.getTracks().length, "peer:", peerId);
    el.srcObject = stream;
    el.volume = 1.0;
    el.muted = false;
    el.play()
      .then(() => console.log("[CyberDeck:Call] #18 remote audio playing, peer:", peerId))
      .catch((err) => console.warn("[CyberDeck:Call] #18/#19 remote audio.play deferred (retry on user gesture):", err?.message));
  }, [stream]); // eslint-disable-line react-hooks/exhaustive-deps

  return <audio ref={audioRef} autoPlay playsInline data-cyberdeck-remote="true" />;
}

// Separate component for remote video to handle ref properly
function RemoteVideo({ stream, isHero = false, peerName, peerImageUrl }: { stream: MediaStream, isHero?: boolean, peerName?: string, peerImageUrl?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasVideo, setHasVideo] = useState(false);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !stream) return;

    const tracks = stream.getTracks();
    console.log("[CyberDeck:Call] #18 RemoteVideo attach. Tracks:", tracks.length,
      tracks.map(t => `${t.kind}/${t.readyState}/muted=${t.muted}`));

    el.srcObject = stream;
    // Keep video element muted — audio is handled by a sibling AudioBridge component
    // so the video element only drives the visual display. Muting also bypasses the
    // browser's autoplay-with-sound restriction, making playback unconditional.
    el.muted = true;
    el.play()
      .then(() => console.log("[CyberDeck:Call] #18 RemoteVideo playing, peer stream tracks:", tracks.length))
      .catch((err) => console.warn("[CyberDeck:Call] #18/#19 RemoteVideo.play deferred (retry on gesture):", err?.message));

    // A remote video track goes through: muted=true (while ICE negotiates) →
    // fires "unmute" when data starts flowing → readyState="live".
    // We must listen to BOTH the stream's addtrack AND each track's unmute/ended
    // to catch the moment the video feed actually arrives.
    const checkVideo = () => {
      const videoTracks = stream.getVideoTracks();
      // "live" covers both unmuted and temporarily muted mid-call.
      // We show video as soon as the track is alive; a muted track still renders
      // the last frame rather than nothing (matches Chrome/Safari behaviour).
      const live = videoTracks.some(t => t.readyState === "live");
      console.log("[CyberDeck:Call] checkVideo:", videoTracks.length, "tracks live:", live);
      setHasVideo(live);
    };

    // Watch track arrivals / departures on the stream
    stream.addEventListener("addtrack", checkVideo);
    stream.addEventListener("removetrack", checkVideo);

    // Watch unmute/ended on every video track already in the stream
    const videoTracks = stream.getVideoTracks();
    videoTracks.forEach(t => {
      t.addEventListener("unmute", checkVideo);
      t.addEventListener("mute", checkVideo);
      t.addEventListener("ended", checkVideo);
    });

    checkVideo();

    return () => {
      stream.removeEventListener("addtrack", checkVideo);
      stream.removeEventListener("removetrack", checkVideo);
      videoTracks.forEach(t => {
        t.removeEventListener("unmute", checkVideo);
        t.removeEventListener("mute", checkVideo);
        t.removeEventListener("ended", checkVideo);
      });
    };
  }, [stream]);

  return (
    <div className="relative w-full h-full">
      {/* Keep the video element in-DOM and playing at all times so autoplay is not
          interrupted. When there is no live video track we layer the "camera off" UI
          on top via absolute positioning instead of hiding the element (display:none
          can suspend playback in Chrome/Safari and block the track from becoming live). */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        data-cyberdeck-remote="true"
        className={cn("w-full h-full object-cover", !hasVideo && "opacity-0 pointer-events-none")}
      />
      {!hasVideo && (
        isHero ? (
          /* Peer connected but their camera is off — use the same blurred-bg /
             avatar + "Camera off" treatment as the pre-connect empty state. */
          <div className="absolute inset-0 overflow-hidden">
            {peerImageUrl ? (
              <img
                src={peerImageUrl}
                alt=""
                aria-hidden
                className="absolute inset-0 w-full h-full object-cover scale-125 blur-2xl opacity-40"
              />
            ) : (
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-indigo-900/60 via-zinc-950 to-black" />
            )}
            <div className="absolute inset-0 bg-black/40" />
            <div className="relative w-full h-full flex flex-col items-center justify-center">
              <div className="relative mb-5">
                <div className="absolute inset-0 -m-3 rounded-full bg-indigo-500/20 blur-xl" />
                <div className="relative h-40 w-40 rounded-full bg-zinc-800 border-4 border-indigo-400/60 shadow-[0_0_60px_rgba(99,102,241,0.4)] flex items-center justify-center overflow-hidden">
                  {peerImageUrl ? (
                    <img src={peerImageUrl} alt="Peer" className="object-cover w-full h-full" />
                  ) : (
                    <span className="text-6xl font-black text-white/60 uppercase">
                      {peerName ? peerName.charAt(0) : "?"}
                    </span>
                  )}
                </div>
              </div>
              <h2 className="text-xl font-bold text-white tracking-tight drop-shadow-md">
                {peerName || "Peer"}
              </h2>
              <p className="mt-1 text-zinc-300/70 text-[10px] font-mono uppercase tracking-[0.3em]">
                Camera off
              </p>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-900">
            <Loader2 className="h-6 w-6 text-zinc-500 animate-spin" />
          </div>
        )
      )}
    </div>
  );
}
