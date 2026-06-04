import { Server as NetServer } from "http";
import { NextApiRequest } from "next";
import { Server as ServerIO } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import fs from "fs";
import path from "path";

import { NextApiResponseServerIo } from "@/types";
import { redis, redisPub, redisSub } from "@/lib/redis";
import { db } from "@/lib/db";
import { publicProfileSelect } from "@/lib/public-profile-select";
import { sendMeshControl } from "@/lib/mesh-control";

function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }

  return null;
}

async function authenticatedProfileId(socket: any): Promise<string | null> {
  const userId = readCookie(socket.request?.headers?.cookie, "cyberdeck-user-id");
  if (!userId) return null;

  const profile = await db.profile.findUnique({
    where: { userId },
    select: { id: true },
  });

  return profile?.id ?? null;
}

function readMeshSignalIdentity(): { profileId: string; username: string } | null {
  const sessionFile =
    process.env.MESH_SESSION_FILE ||
    path.join(process.cwd(), "private", "mesh-session.json");
  try {
    const session = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
    const profileId = String(session.profileId || session.userId || "").trim();
    const username = String(session.username || session.displayName || "").trim();
    if (!profileId || !username || /^node[-_]/i.test(username)) return null;
    return { profileId, username };
  } catch {
    return null;
  }
}

// ── Terminal PTY helper ───────────────────────────────────────────────────────
// Spawns a shell via node-pty and pipes i/o over Socket.io events.
// node-pty is optional — if not installed (e.g. missing build tools on Windows),
// the terminal tab shows a "not available" message instead of crashing.

let ptyModule: typeof import("node-pty") | null = null;
try { ptyModule = require("node-pty"); } catch { /* native addon not built */ }

function resolveShell(): string {
  if (process.platform === "win32") return "powershell.exe";
  // Prefer the login shell from the environment; fall back to bash, then sh
  const envShell = process.env.SHELL;
  if (envShell) return envShell;
  const fs = require("fs");
  for (const s of ["/bin/bash", "/usr/bin/bash", "/bin/sh"]) {
    try { fs.accessSync(s, fs.constants.X_OK); return s; } catch {}
  }
  return "/bin/sh";
}

function resolveCwd(): string {
  if (process.platform === "win32") return process.env.USERPROFILE || "C:\\";
  return process.env.CYBERDECK_HOME || process.env.HOME || process.cwd();
}

function spawnTerminal(socket: any, cols: number, rows: number) {
  if (!ptyModule) {
    socket.emit("terminal:data", "\r\nTerminal not available — node-pty ARM64 prebuilt missing.\r\n");
    return null;
  }
  const shell = resolveShell();
  const cwd   = resolveCwd();
  const pty   = ptyModule.spawn(shell, [], {
    name: "xterm-256color",
    cols: cols || 80,
    rows: rows || 24,
    cwd,
    env:  { ...process.env, TERM: "xterm-256color" } as any,
  });
  pty.onData((data: string) => socket.emit("terminal:data", data));
  pty.onExit(() => socket.emit("terminal:exit"));
  return pty;
}

export const config = {
  api: {
    bodyParser: false
  }
};

// Centralized CallHistory write so every termination path (offline, busy, rejected,
// missed, ended, dropped) records consistently. Failures are logged and swallowed —
// a DB outage must not crash signaling.
async function logCallHistory(opts: {
  callerId: string;
  calleeId: string;
  roomId: string;
  type: string;
  status: string;
  duration: number;
  startedAt?: Date;
}) {
  try {
    await (db as any).callHistory.create({
      data: {
        callerId: opts.callerId,
        calleeId: opts.calleeId,
        roomId: opts.roomId,
        type: opts.type,
        status: opts.status,
        duration: opts.duration,
        startedAt: opts.startedAt ?? new Date(),
        endedAt: new Date(),
      },
    });
  } catch (err) {
    console.error("[CallHistory] write failed:", err);
  }
}

async function findMeshCallPeer(targetUserId?: string) {
  if (!targetUserId) return null;

  const targetProfile = await db.profile.findUnique({
    where: { id: targetUserId },
    select: { id: true, name: true },
  });

  const activeThreshold = new Date(Date.now() - 30 * 1000);
  return db.meshPeer.findFirst({
    where: {
      status: { in: ["TRUSTED", "ACCEPTED"] },
      ipAddress: { not: null },
      lastSeen: { gte: activeThreshold },
      OR: [
        { userId: targetUserId },
        ...(targetProfile?.name ? [{ publicName: targetProfile.name }] : []),
      ],
    },
  });
}

async function relayMeshCallSignal(
  event: string,
  data: any,
  socket: any,
) {
  let peer = await findMeshCallPeer(data?.targetUserId);
  if (!peer && data?.callId) {
    const route = await redis.hgetall(`mesh:call:${data.callId}`);
    if (route?.peerMac) {
      peer = await db.meshPeer.findUnique({ where: { macAddress: route.peerMac } });
    }
  }
  if (!peer?.ipAddress) return false;

  const localSocketUserId = socket?.data?.userId || socket?.data?.authenticatedProfileId || data?.callerUserId || "";
  const localProfile = localSocketUserId
    ? await db.profile.findUnique({ where: { id: localSocketUserId }, select: { name: true } })
    : null;
  const meshIdentity = readMeshSignalIdentity();
  const signalUsername = meshIdentity?.username || localProfile?.name || data?.callerName || "Unknown";
  const signalUserId = meshIdentity?.profileId || localSocketUserId;

  if (data?.callId) {
    await redis.hset(`mesh:call:${data.callId}`, {
      localChatId: data.chatId || "",
      localUserId: localSocketUserId,
      localSignalUserId: signalUserId,
      peerMac: peer.macAddress,
      peerIp: peer.ipAddress,
      peerName: peer.publicName || "",
    });
    await redis.expire(`mesh:call:${data.callId}`, 60 * 60);
  }

  await sendMeshControl(peer.ipAddress, {
    type: "call_signal",
    event,
    fromUsername: signalUsername,
    fromUserId: signalUserId,
    payload: data,
  });
  return true;
}

const ioHandler = (req: NextApiRequest, res: NextApiResponseServerIo) => {
  if (!res.socket.server.io) {
    const path = "/api/socket/io";
    const httpServer: NetServer = res.socket.server as any;
    const io = new ServerIO(httpServer, {
      path,
      // @ts-ignore
      addTrailingSlash: false,
      // ── High-Concurrency Tuning ─────────────────────────────
      maxHttpBufferSize: 1e7, // 10MB buffer for large file/image bursts
      pingTimeout: 60000,     // 60s timeout to prevent drops during network lag
      pingInterval: 25000,
      connectTimeout: 60000,
      transports: ["websocket", "polling"], // Reliable fallback chain
    });

    // ── Redis Adapter ──────────────────────────────────────────
    // Enables cross-node pub/sub so multiple Next.js instances
    // (multiple Pi nodes) can relay socket events to each other.
    io.adapter(createAdapter(redisPub, redisSub));

    // ── Connection Handler ─────────────────────────────────────
    io.on("connection", async (socket) => {
      socket.data.authenticatedProfileId = await authenticatedProfileId(socket);

      // ── Pending Pair-Request Replay ─────────────────────────
      // The kiosk browser connects AFTER the mesh pair_request event fires
      // (Pi boots fast, browser loads slow). This replays any PENDING requests
      // so the modal always shows, regardless of timing.
      // ── Chat Rooms ─────────────────────────────────────────
      socket.on("chat:join", (chatId: string) => {
        socket.join(chatId);
      });

      // ── Presence System ────────────────────────────────────
      socket.on("presence:identify", async (providedProfileId?: string) => {
        const providedId =
          typeof providedProfileId === "string" && /^[0-9a-f-]{20,}$/i.test(providedProfileId)
            ? providedProfileId
            : null;
        const userId = socket.data.authenticatedProfileId || providedId;
        if (!userId) return;
        socket.data.userId = userId;

        // Join a per-user room so call signaling can target this user across devices/tabs
        socket.join(`user:${userId}`);

        try {
          // Track online user in Redis sets
          await redis.sadd("presence:online", userId);
          await redis.hset(`presence:user:${userId}`, {
            socketId: socket.id,
            nodeIp: req.socket.localAddress || "127.0.0.1",
            lastSeen: Date.now().toString(),
          });

          // Broadcast presence update to all connected clients
          io.emit("presence:update", {
            userId,
            status: "online",
            socketId: socket.id,
          });

          // ── Sync Logic: Send current online list to the new joiner ──
          const onlineUserIds = await redis.smembers("presence:online");
          socket.emit("presence:sync", onlineUserIds);

          // ── Catch-up Logic: Deliver pending messages ─────────────────
          // Update all SENT messages where this user is the recipient to DELIVERED
          try {
             const pendingMessages = await db.directMessage.findMany({
               where: {
                 status: "SENT",
                 conversation: {
                   OR: [
                     { memberOne: { profileId: userId } },
                     { memberTwo: { profileId: userId } }
                   ]
                 },
                 member: {
                   NOT: { profileId: userId } // Sent by someone else
                 }
               },
               include: {
                 member: { include: { profile: { select: publicProfileSelect } } }
               }
             });

             if (pendingMessages.length > 0) {
               const messageIds = pendingMessages.map(m => m.id);
               await db.directMessage.updateMany({
                 where: { id: { in: messageIds } },
                 data: { status: "DELIVERED" }
               });

               // Notify senders in real-time
               for (const msg of pendingMessages) {
                 const updateKey = `chat:${msg.conversationId}:messages:update`;
                 const updatedMsg = { ...msg, status: "DELIVERED" };
                 
                 // Clear Redis cache for these conversations to reflect new status
                 await redis.del(`cache:chat:${msg.conversationId}:messages`);
                 
                 io.to(msg.conversationId).emit(updateKey, updatedMsg);
               }
               console.log(`[Presence] Delivered ${pendingMessages.length} pending messages to ${userId}`);
             }
          } catch (catchUpErr) {
            console.error("[Presence] Catch-up error:", catchUpErr);
          }
        } catch (err) {
          console.error("[Presence] Error on identify:", err);
        }
      });

      // ── WebRTC Signaling ───────────────────────────────────
      // Join a media room
      socket.on("webrtc:join", async (data: { roomId: string; type?: string; callId?: string; isInitiator?: boolean }) => {
        const roomId = typeof data === "string" ? data : data.roomId;
        const callType = typeof data === "string" ? "audio" : (data.type || "audio");

        const room = io.sockets.adapter.rooms.get(roomId);
        const numClients = room ? room.size : 0;

        socket.join(roomId);
        socket.data.mediaRoom = roomId;

        try {
          // Store call state in Redis for cross-node visibility
          await redis.sadd(`call:${roomId}`, socket.id);
          await redis.sadd(`call:${roomId}:participants`, socket.id); // Track total unique participants
          if (socket.data.userId) {
            // Track participating user IDs so cleanupCallRoom can target them directly
            await redis.sadd(`call:${roomId}:users`, socket.data.userId);
            // Scenario #4 (busy detection): mark this user as having an active call.
            // 10-minute TTL is a safety net in case cleanup ever fails; webrtc:leave /
            // disconnect handlers clear it explicitly under normal flow.
            await redis.set(`user:${socket.data.userId}:activeCall`, roomId, "EX", 600);
          }

          const metaToSet: any = {
            type: callType,
            startTime: Date.now().toString(),
          };
          if (typeof data !== "string" && data.callId) {
            metaToSet.callId = data.callId;
          }
          await redis.hset(`call:${roomId}:meta`, metaToSet);
        } catch (err) {
          console.error("[WebRTC] Redis error on join:", err);
        }

        if (numClients > 0) {
          // Tell existing peers about the new joiner
          socket.to(roomId).emit("webrtc:peer-joined", {
            peerId: socket.id,
          });
        }

        if (typeof data !== "string" && data.callId && !data.isInitiator) {
          await relayMeshCallSignal("webrtc:peer-joined", {
            chatId: roomId,
            callId: data.callId,
            peerId: socket.id,
          }, socket);
        }
      });

      // Relay WebRTC offer
      socket.on("webrtc:offer", async ({ targetId, offer, callId, chatId }) => {
        if (!io.sockets.sockets.has(targetId)) {
          await relayMeshCallSignal("webrtc:offer", { targetId, offer, callId, chatId, peerId: socket.id }, socket);
          return;
        }
        io.to(targetId).emit("webrtc:offer", {
          peerId: socket.id,
          offer,
        });
      });

      // Relay WebRTC answer
      socket.on("webrtc:answer", async ({ targetId, answer, callId, chatId }) => {
        if (!io.sockets.sockets.has(targetId)) {
          await relayMeshCallSignal("webrtc:answer", { targetId, answer, callId, chatId, peerId: socket.id }, socket);
          return;
        }
        io.to(targetId).emit("webrtc:answer", {
          peerId: socket.id,
          answer,
        });
      });

      // Relay ICE candidates
      socket.on("webrtc:ice-candidate", async ({ targetId, candidate, callId, chatId }) => {
        if (!io.sockets.sockets.has(targetId)) {
          await relayMeshCallSignal("webrtc:ice-candidate", { targetId, candidate, callId, chatId, peerId: socket.id }, socket);
          return;
        }
        io.to(targetId).emit("webrtc:ice-candidate", {
          peerId: socket.id,
          candidate,
        });
      });

      socket.on("webrtc:error", async ({ targetId, message, callId, chatId }) => {
        if (!io.sockets.sockets.has(targetId)) {
          await relayMeshCallSignal("webrtc:error", { targetId, message, callId, chatId, peerId: socket.id }, socket);
          return;
        }
        io.to(targetId).emit("webrtc:error", {
          peerId: socket.id,
          message,
        });
      });

      // ── Call Notifications (Ringing) ───────────────────────
      // Route to a specific user-room when targetUserId is supplied (1:1 DM calls).
      // Fall back to the chatId room for group/channel calls so existing members still get notified.
      const routeCallEvent = async (event: string, data: { chatId: string; targetUserId?: string; callId?: string }) => {
        if (data.targetUserId) {
          io.to(`user:${data.targetUserId}`).emit(event, data);
        } else {
          io.to(data.chatId).emit(event, data);
        }
        await relayMeshCallSignal(event, data, socket);
      };

      // Common meta-write helper so the cleanup path always sees consistent fields
      const writeCallMeta = async (chatId: string, fields: Record<string, string>) => {
        try {
          await redis.hset(`call:${chatId}:meta`, fields);
        } catch (err) {
          console.error("[WebRTC] Redis error writing call meta:", err);
        }
      };

      socket.on("call:start", async (data: { chatId: string; callId: string; callerName: string; callerUserId?: string; targetUserId?: string; type: string }) => {
        // Scenario #1 (offline) and #4 (busy) — short-circuit before the recipient ever rings.
        // We still write meta so cleanupCallRoom records the right CallHistory status
        // when the caller's MediaRoom tears down in response to call:offline / call:busy.
        if (data.targetUserId) {
          const startMeta: Record<string, string> = {
            callerUserId: data.callerUserId ?? "",
            targetUserId: data.targetUserId,
            callId: data.callId ?? "",
            type: data.type ?? "audio",
            startTime: String(Date.now()),
          };

          // #1: offline check
          const isOnline = await redis.sismember("presence:online", data.targetUserId);
          if (!isOnline) {
            if (await relayMeshCallSignal("call:start", data, socket)) return;
            await writeCallMeta(data.chatId, { ...startMeta, status: "offline" });
            if (data.callerUserId) {
              io.to(`user:${data.callerUserId}`).emit("call:offline", {
                chatId: data.chatId,
                callId: data.callId,
                targetUserId: data.targetUserId,
              });
            }
            return;
          }

          // #4: busy check — target already has an active call in another room
          const targetActiveCall = await redis.get(`user:${data.targetUserId}:activeCall`);
          if (targetActiveCall && targetActiveCall !== data.chatId) {
            await writeCallMeta(data.chatId, { ...startMeta, status: "busy" });
            if (data.callerUserId) {
              io.to(`user:${data.callerUserId}`).emit("call:busy", {
                chatId: data.chatId,
                callId: data.callId,
                targetUserId: data.targetUserId,
              });
            }
            return;
          }

          await writeCallMeta(data.chatId, startMeta);
        } else if (data.callerUserId) {
          // Group/channel call: still seed meta so cleanup logs sensibly.
          await writeCallMeta(data.chatId, {
            callerUserId: data.callerUserId,
            callId: data.callId ?? "",
            type: data.type ?? "audio",
            startTime: String(Date.now()),
          });
        }

        await routeCallEvent("call:start", data);
      });

      // Scenario #2 (rejected): the client just declined — record the reason for the
      // cleanup logger so the CallHistory row has status="rejected" (not "missed").
      socket.on("call:decline", async (data: { chatId: string; callId?: string; targetUserId?: string }) => {
        if (data.chatId) {
          await writeCallMeta(data.chatId, { status: "rejected" });
        }
        await routeCallEvent("call:decline", data);
      });

      socket.on("call:accept", async (data: { chatId: string; callId?: string; targetUserId?: string }) => {
        await routeCallEvent("call:accept", data);
      });

      // Scenario #3 (no answer): caller's 30s timer fired. Tell the callee to stop ringing
      // and mark the call as missed for the DB.
      socket.on("call:timeout", async (data: { chatId: string; callId?: string; targetUserId?: string }) => {
        if (data.chatId) {
          await writeCallMeta(data.chatId, { status: "missed" });
        }
        // Notify the callee so their ring UI dismisses immediately.
        await routeCallEvent("call:timeout", data);
      });

      // Scenario #8 (dropped): the client detected ICE failure and is ending. The `reason`
      // field upgrades the cleanup logger to status="dropped" instead of the default "ended".
      socket.on("call:end", async (data: { chatId: string; callId?: string; targetUserId?: string; reason?: string }) => {
        if (data.chatId && data.reason) {
          await writeCallMeta(data.chatId, { status: data.reason });
        }
        await routeCallEvent("call:end", data);
      });

      // Client-side busy: callee's CallProvider detected a second incoming call while
      // already ringing. Echo back to the caller so the server's "busy" path is consistent
      // with the client's, and record the DB status.
      socket.on("call:busy", async (data: { chatId: string; callId?: string; targetUserId?: string }) => {
        if (data.chatId) {
          await writeCallMeta(data.chatId, { status: "busy" });
        }
        await routeCallEvent("call:busy", data);
      });

      // Leave media room
      socket.on("webrtc:leave", async (roomId: string) => {
        socket.to(roomId).emit("webrtc:peer-left", {
          peerId: socket.id,
        });
        socket.leave(roomId);

        // Clear the busy marker for this user if it points at this room.
        if (socket.data.userId) {
          try {
            const currentActive = await redis.get(`user:${socket.data.userId}:activeCall`);
            if (currentActive === roomId) {
              await redis.del(`user:${socket.data.userId}:activeCall`);
            }
          } catch (err) {
            console.error("[WebRTC] Redis error clearing activeCall:", err);
          }
        }

        await cleanupCallRoom(io, roomId, socket.id);
        // Prevent the disconnect handler from re-running cleanup for a room we've already left
        if (socket.data.mediaRoom === roomId) {
          socket.data.mediaRoom = undefined;
        }
      });

      // ── Disconnect Handler ─────────────────────────────────
      // ── Message Status Signaling ──────────────────────────
      
      // When a recipient receives a message in their client
      socket.on("message:delivered", async ({ messageId, type }: { messageId: string, type: "channel" | "direct" }) => {
        try {
          const now = new Date();
          if (type === "direct") {
            await (db.directMessage as any).update({
              where: { id: messageId },
              data: { status: "DELIVERED", deliveredAt: now }
            });
          } else {
            // For channels, we track delivery per member
            // (Implementation for GroupMessageStatus)
          }
          // Notify the sender
          socket.broadcast.emit("message:status-update", { messageId, status: "DELIVERED", timestamp: now });
        } catch (err) {
          console.error("Error updating delivery status:", err);
        }
      });

      // When a recipient opens the chat and reads messages
      socket.on("message:read", async ({ messageIds, type, chatId }: { messageIds: string[], type: "channel" | "direct", chatId: string }) => {
        try {
          const now = new Date();
          if (type === "direct") {
            await (db.directMessage as any).updateMany({
              where: { id: { in: messageIds } },
              data: { status: "READ", readAt: now }
            });
          }
          // Notify the room/sender
          io.to(chatId).emit("message:status-update", { messageIds, status: "READ", timestamp: now });
        } catch (err) {
          console.error("Error updating read status:", err);
        }
      });

      // ── Terminal ───────────────────────────────────────────────────────────
      // One PTY per socket — the client creates it when the Terminal tab opens.
      let pty: ReturnType<typeof spawnTerminal> = null;

      socket.on("terminal:create", ({ cols, rows }: { cols: number; rows: number }) => {
        if (!socket.data.authenticatedProfileId) {
          socket.emit("terminal:data", "\r\nTerminal unavailable: authentication required.\r\n");
          return;
        }

        if (pty) { try { pty.kill(); } catch {} }
        pty = spawnTerminal(socket, cols || 80, rows || 24);
      });

      socket.on("terminal:input", (data: string) => {
        try { pty?.write(data); } catch {}
      });

      socket.on("terminal:resize", ({ cols, rows }: { cols: number; rows: number }) => {
        try { pty?.resize(cols, rows); } catch {}
      });

      socket.on("terminal:kill", () => {
        try { pty?.kill(); } catch {}
        pty = null;
      });

      socket.on("disconnect", async () => {
        // Kill any open PTY on disconnect
        try { pty?.kill(); } catch {}
        pty = null;

        // Clean up presence
        const userId = socket.data.userId;
        if (userId) {
          try {
            await redis.srem("presence:online", userId);
            await redis.del(`presence:user:${userId}`);

            io.emit("presence:update", {
              userId,
              status: "offline",
            });
          } catch (err) {
            console.error("[Presence] Error on disconnect:", err);
          }
        }

        // Clean up WebRTC room
        const roomId = socket.data.mediaRoom;
        if (roomId) {
          socket.to(roomId).emit("webrtc:peer-left", {
            peerId: socket.id,
          });
          if (socket.data.userId) {
            try {
              const currentActive = await redis.get(`user:${socket.data.userId}:activeCall`);
              if (currentActive === roomId) {
                await redis.del(`user:${socket.data.userId}:activeCall`);
              }
            } catch (err) {
              console.error("[WebRTC] Redis error clearing activeCall on disconnect:", err);
            }
          }
          await cleanupCallRoom(io, roomId, socket.id);
          socket.data.mediaRoom = undefined;
        }
      });
    });

    res.socket.server.io = io;
  }

  if (req.url?.includes("/api/socket/io")) {
    console.log(`[Socket:Route] Hit ${req.method} ${req.url} (socket connected: ${!!res.socket?.server?.io})`);
    res.end();
  }
};

/**
 * Remove socket from a call room in Redis.
 * When the room becomes empty, log the call to SQLite CallHistory.
 */
async function cleanupCallRoom(io: ServerIO, roomId: string, socketId: string) {
  try {
    await redis.srem(`call:${roomId}`, socketId);
    const remaining = await redis.scard(`call:${roomId}`);

    if (remaining === 0) {
      // Guard against double-fire (webrtc:leave + disconnect): if meta is already gone,
      // another cleanup pass already handled this room.
      const metaExists = await redis.exists(`call:${roomId}:meta`);
      if (!metaExists) {
        return;
      }

      const meta = await redis.hgetall(`call:${roomId}:meta`);
      console.log(`[WebRTC:Server] Room ${roomId} is now empty. Sending targeted termination signal.`);

      // FAIL-SAFE: notify the call's participants (not every connected socket).
      const endPayload = { chatId: roomId, callId: meta?.callId };
      if (meta?.callerUserId) {
        io.to(`user:${meta.callerUserId}`).emit("call:end", endPayload);
      }
      if (meta?.targetUserId) {
        io.to(`user:${meta.targetUserId}`).emit("call:end", endPayload);
      }
      if (!meta?.callerUserId && !meta?.targetUserId) {
        io.to(roomId).emit("call:end", endPayload);
      }

      const participantCount = await redis.scard(`call:${roomId}:participants`);

      // Decide the final CallHistory status. Honor any explicit status the signaling
      // handlers wrote (rejected / missed / busy / offline / dropped); fall back to the
      // legacy heuristic only when nothing more specific is known.
      let status: string;
      let duration = 0;
      const startTime = meta?.startTime ? parseInt(meta.startTime, 10) : null;
      const realDuration = startTime ? Math.round((Date.now() - startTime) / 1000) : 0;

      if (meta?.status === "rejected" || meta?.status === "missed" ||
          meta?.status === "busy" || meta?.status === "offline") {
        status = meta.status;
        duration = 0;
      } else if (meta?.status === "dropped") {
        status = "dropped";
        duration = realDuration;
      } else if (meta?.status === "ended") {
        status = "ended";
        duration = realDuration;
      } else {
        // Heuristic fallback: nobody recorded a reason. If two parties were ever in the
        // room together, treat as ended; otherwise missed.
        status = participantCount > 1 ? "ended" : "missed";
        duration = status === "ended" ? realDuration : 0;
      }

      // Write CallHistory BEFORE deleting meta so we can still read participants/type.
      if (meta?.callerUserId && meta?.targetUserId) {
        await logCallHistory({
          callerId: meta.callerUserId,
          calleeId: meta.targetUserId,
          roomId,
          type: meta.type || "audio",
          status,
          duration,
          startedAt: startTime ? new Date(startTime) : new Date(),
        });
        console.log(`[CallHistory] Logged ${status} call for ${roomId} (duration=${duration}s)`);
      }

      // Clean up Redis
      await redis.del(
        `call:${roomId}`,
        `call:${roomId}:meta`,
        `call:${roomId}:participants`,
        `call:${roomId}:users`
      );
    }
  } catch (err) {
    console.error("[WebRTC] cleanupCallRoom error:", err);
  }
}

export default ioHandler;
