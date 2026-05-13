"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { Loader2, Mic, MicOff, Video, VideoOff, PhoneOff } from "lucide-react";
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
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, PeerConnection>>(new Map());

  // Get local media stream
  const getLocalStream = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: video,
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      // Apply initial mute state
      stream.getAudioTracks().forEach(t => t.enabled = !isMuted);
      stream.getVideoTracks().forEach(t => t.enabled = !isVideoOff);
      return stream;
    } catch (err) {
      console.error("Failed to get media:", err);
      return null;
    }
  }, [video, isMuted, isVideoOff]);

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
      event.streams[0].getTracks().forEach(track => {
        remoteStream.addTrack(track);
      });
      setPeers(prev => new Map(prev).set(peerId, { pc, remoteStream }));
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

  // Join the media room
  useEffect(() => {
    if (!socket || isJoined) return;

    const joinRoom = async () => {
      const stream = await getLocalStream();
      if (!stream) return;

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
        const peer = peersRef.current.get(peerId);
        if (peer) {
          peer.pc.close();
          peersRef.current.delete(peerId);
          setPeers(prev => {
            const next = new Map(prev);
            next.delete(peerId);
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

      localStreamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [socket, chatId, isJoined, getLocalStream, createPeerConnection]);

  // Toggle mute
  const toggleMute = () => {
    localStreamRef.current?.getAudioTracks().forEach(t => {
      t.enabled = isMuted;
    });
    setIsMuted(!isMuted);
  };

  // Toggle video
  const toggleVideo = () => {
    localStreamRef.current?.getVideoTracks().forEach(t => {
      t.enabled = isVideoOff;
    });
    setIsVideoOff(!isVideoOff);
  };

  // Leave call
  const leaveCall = () => {
    if (socket) {
      socket.emit("webrtc:leave", chatId);
    }
    localStreamRef.current?.getTracks().forEach(t => t.stop());
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

    // Send a "Call Ended" message to the chat
    axios.post(`/api/socket/direct-messages?conversationId=${chatId}`, {
      content: "📞 Video call ended",
    }).catch(() => {});

    router.push(url);
  };

  if (!isJoined) {
    return (
      <div className="flex flex-col flex-1 justify-center items-center">
        <Loader2 className="h-7 w-7 text-zinc-500 animate-spin my-4" />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Connecting to LAN peers...
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 bg-[#1e1f22]">
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

      {/* Controls */}
      <div className="flex items-center justify-center gap-4 p-4 bg-[#2b2d31] border-t border-white/10">
        <button
          onClick={toggleMute}
          className={`p-3 rounded-full transition ${
            isMuted ? 'bg-rose-500 hover:bg-rose-600' : 'bg-zinc-600 hover:bg-zinc-500'
          }`}
        >
          {isMuted ? <MicOff className="h-5 w-5 text-white" /> : <Mic className="h-5 w-5 text-white" />}
        </button>
        {video && (
          <button
            onClick={toggleVideo}
            className={`p-3 rounded-full transition ${
              isVideoOff ? 'bg-rose-500 hover:bg-rose-600' : 'bg-zinc-600 hover:bg-zinc-500'
            }`}
          >
            {isVideoOff ? <VideoOff className="h-5 w-5 text-white" /> : <Video className="h-5 w-5 text-white" />}
          </button>
        )}
        <button
          onClick={leaveCall}
          className="p-3 rounded-full bg-rose-600 hover:bg-rose-700 transition"
        >
          <PhoneOff className="h-5 w-5 text-white" />
        </button>
      </div>
    </div>
  );
}

// Separate component for remote video to handle ref properly
function RemoteVideo({ stream }: { stream: MediaStream }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      className="w-full h-full object-cover"
    />
  );
}
