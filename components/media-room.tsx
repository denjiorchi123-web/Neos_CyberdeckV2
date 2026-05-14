"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { Loader2, Mic, MicOff, Video, VideoOff, PhoneOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSocket } from "@/components/providers/socket-provider";
import { usePathname, useRouter } from "next/navigation";
import qs from "query-string";
import axios from "axios";

interface MediaRoomProps {
  chatId: string;
  video: boolean;
  audio: boolean;
}

interface PeerConnection {
  pc: RTCPeerConnection;
  remoteStream: MediaStream;
}

// LAN-only: no STUN/TURN needed — direct host candidates work
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [],
};

export function MediaRoom({ chatId, video, audio }: MediaRoomProps) {
  const { socket } = useSocket();
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
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);

  // Helper to format seconds into MM:SS
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Timer logic: Start counting when at least one peer is connected
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (peers.size > 0) {
      interval = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);
    } else {
      setDuration(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [peers.size]);

  // Sync local video element with stream
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      console.log("[MediaRoom] Syncing local video element");
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, isVideoOff]);

  // Get local media stream
  const getLocalStream = useCallback(async () => {
    try {
      if (!window.isSecureContext) {
        setError("Browser Security Block: Camera access is disabled on non-HTTPS network connections. Please go to 'chrome://flags/#unsafely-treat-insecure-origin-as-secure' and add your IP.");
        return null;
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setError("No media devices found. Please ensure your camera and microphone are connected to the CyberDeck.");
        return null;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: video,
      });
      localStreamRef.current = stream;
      setLocalStream(stream);
      // Apply initial mute state
      return stream;
    } catch (err) {
      console.error("Failed to get media:", err);
      return null;
    }
  }, [video]);

  // Create peer connection for a remote peer
  const createPeerConnection = useCallback((peerId: string, localStream: MediaStream) => {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const remoteStream = new MediaStream();

    // Add local tracks to connection
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });

    // Collect remote tracks
    pc.ontrack = (event) => {
      console.log(`[MediaRoom] Received remote track: ${event.track.kind} from ${peerId}`);
      const stream = event.streams[0];

      // Update the peers state with the actual stream from the event
      setPeers(prev => {
        const next = new Map(prev);
        next.set(peerId, { pc, remoteStream: stream });
        return next;
      });
    };

    // Send ICE candidates via Socket.io
    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit("webrtc:ice-candidate", {
          targetId: peerId,
          candidate: event.candidate,
        });
      }
    };

    const peerConn = { pc, remoteStream };
    peersRef.current.set(peerId, peerConn);
    setPeers(prev => new Map(prev).set(peerId, peerConn));

    return pc;
  }, [socket]);

  // Leave call
  const leaveCall = useCallback((isManual: boolean = true) => {
    if (socket && chatId) {
      socket.emit("call:end", { chatId });
      socket.emit("webrtc:leave", chatId);
    }


    // Force stop all tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        track.stop();
        console.log(`[Media] Stopped track: ${track.kind}`);
      });
      localStreamRef.current = null;
      setLocalStream(null);
    }

    peersRef.current.forEach(peer => peer.pc.close());
    peersRef.current.clear();
    setPeers(new Map());
    setIsJoined(false);

    // Redirect to clear the video state in URL
    const url = qs.stringifyUrl(
      {
        url: pathName || "",
        query: {
          video: undefined
        }
      },
      { skipNull: true }
    );

    if (isManual) {
      const callType = video ? "Video" : "Voice";
      axios.post(`/api/socket/direct-messages?conversationId=${chatId}`, {
        content: `📞 ${callType} call ended`,
      }).catch(() => { });
    }

    router.push(url);
  }, [chatId, pathName, router, socket]);

  // Join the media room
  useEffect(() => {
    if (!socket) return;

    const joinRoom = async () => {
      // Clear any old connections before joining to prevent duplicate boxes
      peersRef.current.forEach(peer => peer.pc.close());
      peersRef.current.clear();
      setPeers(new Map());

      // If we've already joined this room, don't join again
      if (isJoined) return;

      // Listen for call decline (if we are the caller and they reject us)
      socket.on("call:decline", (data: { chatId: string }) => {
        if (data.chatId === chatId) {
          console.log("[MediaRoom] Call was declined by peer.");
          setError("Call Declined: The peer is busy or unavailable.");
          setTimeout(() => leaveCall(false), 2000);
        }
      });

      // Auto-terminate if no one answers in 45 seconds
      const noAnswerTimeout = setTimeout(() => {
        if (peersRef.current.size === 0) {
          console.log("[MediaRoom] No answer timeout.");
          setError("No Answer: The peer did not pick up.");
          setTimeout(() => leaveCall(false), 2000);
        }
      }, 45000);

      const stream = await getLocalStream();
      if (!stream) return;

      // Apply initial mute/video states immediately without restarting the connection
      stream.getAudioTracks().forEach(t => t.enabled = audio);
      stream.getVideoTracks().forEach(t => t.enabled = video);

      // Sync internal state with initial hardware state
      setIsMuted(!audio);
      setIsVideoOff(!video);

      // When a new peer joins, we create an offer
      socket.on("webrtc:peer-joined", async ({ peerId }: { peerId: string }) => {
        const pc = createPeerConnection(peerId, stream);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit("webrtc:offer", { targetId: peerId, offer });
      });

      // When we receive an offer, create answer
      socket.on("webrtc:offer", async ({ peerId, offer }: { peerId: string; offer: RTCSessionDescriptionInit }) => {
        const pc = createPeerConnection(peerId, stream);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("webrtc:answer", { targetId: peerId, answer });
      });

      // When we receive an answer
      socket.on("webrtc:answer", async ({ peerId, answer }: { peerId: string; answer: RTCSessionDescriptionInit }) => {
        const peer = peersRef.current.get(peerId);
        if (peer) {
          await peer.pc.setRemoteDescription(new RTCSessionDescription(answer));
        }
      });

      // When we receive an ICE candidate
      socket.on("webrtc:ice-candidate", async ({ peerId, candidate }: { peerId: string; candidate: RTCIceCandidateInit }) => {
        const peer = peersRef.current.get(peerId);
        if (peer) {
          await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
      });

      // When a peer leaves
      socket.on("webrtc:peer-left", ({ peerId }: { peerId: string }) => {
        console.log(`[MediaRoom] Peer left: ${peerId}`);
        const peer = peersRef.current.get(peerId);
        if (peer) {
          peer.pc.close();
          peersRef.current.delete(peerId);
          setPeers(prev => {
            const next = new Map(prev);
            next.delete(peerId);

            // WHATSAPP/DISCORD MECHANISM:
            // If we are in a 1:1 chat and the only other person left, 
            // we should also leave the room automatically.
            if (next.size === 0) {
              console.log("[MediaRoom] No peers left. Hanging up in 1.5s...");
              setTimeout(() => leaveCall(false), 1500); // Delay to allow chat sync
            }

            return next;
          });
        }
      });

      // Join the signaling room
      socket.emit("webrtc:join", chatId);
      setIsJoined(true);
    };

    joinRoom();

    return () => {
      // Cleanup on unmount
      socket.emit("webrtc:leave", chatId);
      socket.off("webrtc:peer-joined");
      socket.off("webrtc:offer");
      socket.off("webrtc:answer");
      socket.off("webrtc:ice-candidate");
      socket.off("webrtc:peer-left");

      peersRef.current.forEach(peer => peer.pc.close());
      peersRef.current.clear();

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }
    };
  }, [socket, chatId, getLocalStream, createPeerConnection, leaveCall]);

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



  if (error) {
    const isPermissionError = error.toLowerCase().includes("permission") || error.toLowerCase().includes("blocked");

    return (
      <div className="flex flex-col h-full items-center justify-center p-4 text-center bg-[#1e1f22] animate-in zoom-in-95 duration-300">
        <div className="h-16 w-16 rounded-full bg-rose-500/10 flex items-center justify-center mb-4 border border-rose-500/20">
          <PhoneOff className="h-8 w-8 text-rose-500" />
        </div>
        <h2 className="text-white font-bold text-xl mb-1">
          {isPermissionError ? "Access Denied" : "Call Terminated"}
        </h2>
        <p className="text-zinc-400 text-xs max-w-xs mb-6">
          {error}
        </p>
        {!isPermissionError && (
          <div className="flex items-center gap-x-2 text-zinc-500 text-[10px] uppercase tracking-[0.2em] font-bold">
            <div className="h-1 w-1 rounded-full bg-indigo-500 animate-ping" />
            Restoring Chat View...
          </div>
        )}
        {isPermissionError && (
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg font-bold text-sm transition-all shadow-lg active:scale-95"
          >
            Retry Connection
          </button>
        )}
      </div>
    );
  }

  if (!isJoined) {
    return (
      <div className="flex flex-col flex-1 justify-center items-center bg-[#1e1f22]">
        <Loader2 className="h-5 w-5 text-zinc-500 animate-spin mb-2" />
        <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">
          Encrypting Signal...
        </p>
      </div>
    );
  }

  // HERO MODE: Voice only (Large, centralized interface)
  if (!video) {
    return (
      <div className="flex flex-col flex-1 bg-gradient-to-b from-[#1e1f22] to-[#111214] relative overflow-hidden group">
        {/* Animated Background Mesh */}
        <div className="absolute inset-0 opacity-10 pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-500 rounded-full blur-[120px] animate-pulse" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600 rounded-full blur-[120px] animate-pulse [animation-delay:2s]" />
        </div>

        {/* Header Status */}
        <div className="absolute top-4 left-6 flex items-center gap-x-2 z-20">
          <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_10px_#10b981]" />
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest font-mono">
            Secure_Mesh_Link // Active
          </span>
        </div>

        {/* Central Hero Section */}
        <div className="flex-1 flex flex-col items-center justify-center relative z-10">
          <div className="relative group/avatar">
            {/* Pulsing Waveform Rings */}
            <div className="absolute inset-0 rounded-full bg-indigo-500/20 animate-ping scale-150 duration-[3s]" />
            <div className="absolute inset-0 rounded-full bg-indigo-500/10 animate-ping scale-[2] duration-[4s]" />

            {/* Main Avatar */}
            <div className="relative h-40 w-40 md:h-56 md:w-56 rounded-full bg-gradient-to-br from-indigo-500 via-purple-600 to-indigo-700 flex items-center justify-center text-white text-5xl md:text-7xl font-bold shadow-[0_0_50px_rgba(99,102,241,0.3)] ring-4 ring-white/5 transition-transform group-hover/avatar:scale-105 duration-500">
              {peers.size > 0 ? "CD" : "YP"}

              {/* Talking Indicator */}
              {peers.size > 0 && (
                <div className="absolute inset-0 rounded-full ring-4 ring-emerald-500 animate-pulse" />
              )}
            </div>

            {/* Floating Info Tag */}
            <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 px-4 py-1.5 bg-[#1e1f22] border border-white/10 rounded-full shadow-2xl backdrop-blur-xl">
              <p className="text-xs font-bold text-white whitespace-nowrap tracking-wider">
                {peers.size > 0 ? "PEER CONNECTED" : "ESTABLISHING SIGNAL..."}
              </p>
            </div>
          </div>

          <div className="mt-16 text-center">
            <div className="mb-2 inline-flex items-center gap-x-2 px-3 py-1 bg-indigo-500/10 border border-indigo-500/20 rounded-full">
              <div className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-pulse" />
              <span className="text-indigo-400 font-mono text-sm font-bold tracking-widest">
                {formatDuration(duration)}
              </span>
            </div>
            <h2 className="text-2xl md:text-3xl font-bold text-white tracking-tight mb-2">
              {peers.size > 0 ? "Voice Conversation" : "Waiting for Answer..."}
            </h2>
            <p className="text-zinc-500 text-xs font-mono uppercase tracking-[0.3em]">
              Bitrate: 128kbps // Latency: 12ms
            </p>
          </div>
        </div>

        {/* Command Bar (Bottom) */}
        <div className="h-[100px] flex items-center justify-center gap-x-8 px-8 relative z-20">
          {/* Hidden Audio Bridge: This plays the remote peer's voice */}
          {Array.from(peers.entries()).map(([peerId, { remoteStream }]) => (
            <audio
              key={peerId}
              autoPlay
              ref={(el) => {
                if (el && remoteStream) el.srcObject = remoteStream;
              }}
            />
          ))}

          <div className="flex items-center gap-x-4 bg-white/5 backdrop-blur-md p-2 rounded-2xl border border-white/10">
            <button
              onClick={toggleMute}
              className={cn(
                "p-4 rounded-xl transition-all duration-300",
                isMuted
                  ? "bg-rose-500 text-white shadow-[0_0_20px_rgba(244,63,94,0.3)]"
                  : "bg-transparent text-zinc-400 hover:text-white hover:bg-white/5"
              )}
            >
              {isMuted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
            </button>

            <div className="h-6 w-[1px] bg-white/10" />

            <button
              onClick={() => leaveCall(true)}
              className="group flex items-center gap-x-3 px-8 py-4 bg-rose-600 hover:bg-rose-700 text-white rounded-xl transition-all duration-300 font-bold uppercase tracking-widest text-xs shadow-[0_0_30px_rgba(225,29,72,0.4)] active:scale-95"
            >
              <PhoneOff className="h-5 w-5 group-hover:rotate-[135deg] transition-transform duration-500" />
              Terminate Link
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 bg-[#1e1f22] relative">
      {/* Floating Timer (Top Center) */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 z-50">
        <div className="flex items-center gap-x-2 px-4 py-2 bg-black/40 backdrop-blur-md border border-white/10 rounded-full shadow-2xl">
          <div className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-pulse" />
          <span className="text-white font-mono text-xs font-bold tracking-widest">
            {formatDuration(duration)}
          </span>
        </div>
      </div>

      {/* Video Grid */}
      <div className="flex-1 p-4 grid gap-4 auto-rows-fr" style={{
        gridTemplateColumns: `repeat(${Math.min(peers.size + 1, 3)}, 1fr)`,
      }}>
        {/* Local video */}
        <div className="relative bg-[#2b2d31] rounded-xl overflow-hidden border border-white/10">
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            className={`w-full h-full object-cover ${isVideoOff ? 'hidden' : ''}`}
          />
          {isVideoOff && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-16 h-16 rounded-full bg-indigo-500 flex items-center justify-center text-white font-bold text-xl">
                CD
              </div>
            </div>
          )}
          <div className="absolute bottom-2 left-2 px-2 py-1 bg-black/60 rounded text-[10px] text-white font-mono">
            YOU {isMuted && "(muted)"}
          </div>
          {isVideoOff && (
            <button
              onClick={getLocalStream}
              className="absolute top-2 right-2 p-1.5 bg-indigo-500 hover:bg-indigo-600 rounded-md text-[10px] text-white transition"
            >
              Force Camera
            </button>
          )}
        </div>

        {/* Remote peer videos */}
        {Array.from(peers.entries()).map(([peerId, peer]) => (
          <div key={peerId} className="relative bg-[#2b2d31] rounded-xl overflow-hidden border border-white/10">
            <RemoteVideo stream={peer.remoteStream} />
            <div className="absolute bottom-2 left-2 px-2 py-1 bg-black/60 rounded text-[10px] text-white font-mono">
              PEER-{peerId.slice(0, 6)}
            </div>
          </div>
        ))}
      </div>

      {/* Floating Controls Bar (Bottom Center) */}
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-x-4 px-6 py-3 bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] animate-in slide-in-from-bottom-10 duration-500">
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleMute();
          }}
          className={cn(
            "p-3 rounded-xl transition-all hover:scale-110 active:scale-95",
            isMuted ? "bg-rose-500 text-white shadow-[0_0_20px_rgba(244,63,94,0.3)]" : "bg-white/10 text-white hover:bg-white/20"
          )}
        >
          {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </button>

        {video && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleVideo();
            }}
            className={cn(
              "p-3 rounded-xl transition-all hover:scale-110 active:scale-95",
              isVideoOff ? "bg-rose-500 text-white shadow-[0_0_20px_rgba(244,63,94,0.3)]" : "bg-white/10 text-white hover:bg-white/20"
            )}
          >
            {isVideoOff ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
          </button>
        )}

        <div className="h-6 w-[1px] bg-white/10 mx-2" />

        <button
          onClick={(e) => {
            e.stopPropagation();
            leaveCall(true);
          }}
          className="p-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white transition-all hover:scale-110 active:scale-95 shadow-lg shadow-rose-600/20"
        >
          <PhoneOff className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

// Separate component for remote video to handle ref properly
function RemoteVideo({ stream }: { stream: MediaStream }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasVideo, setHasVideo] = useState(false);

  useEffect(() => {
    if (!videoRef.current || !stream) return;

    console.log("[RemoteVideo] Attaching stream to element. Tracks:", stream.getTracks().length);
    videoRef.current.srcObject = stream;

    const handleTrackUpdate = () => {
      setHasVideo(stream.getVideoTracks().some(t => t.enabled && t.readyState === "live"));
    };

    stream.addEventListener("addtrack", handleTrackUpdate);
    stream.addEventListener("removetrack", handleTrackUpdate);

    // Initial check
    handleTrackUpdate();

    return () => {
      stream.removeEventListener("addtrack", handleTrackUpdate);
      stream.removeEventListener("removetrack", handleTrackUpdate);
    };
  }, [stream]);

  return (
    <div className="relative w-full h-full">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="w-full h-full object-cover"
      />
      {!hasVideo && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/50">
          <Loader2 className="h-6 w-6 text-zinc-500 animate-spin" />
        </div>
      )}
    </div>
  );
}
