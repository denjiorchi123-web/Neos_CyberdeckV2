import { Server as NetServer } from "http";
import { NextApiRequest } from "next";
import { Server as ServerIO } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";

import { NextApiResponseServerIo } from "@/types";
import { redis, redisPub, redisSub } from "@/lib/redis";
import { db } from "@/lib/db";

export const config = {
  api: {
    bodyParser: false
  }
};

const ioHandler = (req: NextApiRequest, res: NextApiResponseServerIo) => {
  if (!res.socket.server.io) {
    const path = "/api/socket/io";
    const httpServer: NetServer = res.socket.server as any;
    const io = new ServerIO(httpServer, {
      path,
      // @ts-ignore
      addTrailingSlash: false
    });

    // ── Redis Adapter ──────────────────────────────────────────
    // Enables cross-node pub/sub so multiple Next.js instances
    // (multiple Pi nodes) can relay socket events to each other.
    io.adapter(createAdapter(redisPub, redisSub));

    // ── Connection Handler ─────────────────────────────────────
    io.on("connection", (socket) => {
      // ── Chat Rooms ─────────────────────────────────────────
      socket.on("chat:join", (chatId: string) => {
        socket.join(chatId);
      });

      // ── Presence System ────────────────────────────────────
      socket.on("presence:identify", async (userId: string) => {
        if (!userId) return;
        socket.data.userId = userId;

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
                 member: { include: { profile: true } }
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
      socket.on("webrtc:join", async (data: { roomId: string; type?: string }) => {
        const roomId = typeof data === "string" ? data : data.roomId;
        const callType = typeof data === "string" ? "audio" : (data.type || "audio");

        const room = io.sockets.adapter.rooms.get(roomId);
        const numClients = room ? room.size : 0;

        socket.join(roomId);
        socket.data.mediaRoom = roomId;

        try {
          // Store call state in Redis for cross-node visibility
          await redis.sadd(`call:${roomId}`, socket.id);
          await redis.hset(`call:${roomId}:meta`, {
            type: callType,
            startTime: Date.now().toString(),
          });
        } catch (err) {
          console.error("[WebRTC] Redis error on join:", err);
        }

        if (numClients > 0) {
          // Tell existing peers about the new joiner
          socket.to(roomId).emit("webrtc:peer-joined", {
            peerId: socket.id,
          });
        }
      });

      // Relay WebRTC offer
      socket.on("webrtc:offer", ({ targetId, offer }) => {
        io.to(targetId).emit("webrtc:offer", {
          peerId: socket.id,
          offer,
        });
      });

      // Relay WebRTC answer
      socket.on("webrtc:answer", ({ targetId, answer }) => {
        io.to(targetId).emit("webrtc:answer", {
          peerId: socket.id,
          answer,
        });
      });

      // Relay ICE candidates
      socket.on("webrtc:ice-candidate", ({ targetId, candidate }) => {
        io.to(targetId).emit("webrtc:ice-candidate", {
          peerId: socket.id,
          candidate,
        });
      });

      // ── Call Notifications (Ringing) ───────────────────────
      socket.on("call:start", (data: { chatId: string; callerName: string; type: string }) => {
        // Broadcast to everyone (in this local mesh, we rely on the client to filter)
        socket.broadcast.emit("call:start", data);
      });

      // Leave media room
      socket.on("webrtc:leave", async (roomId: string) => {
        socket.to(roomId).emit("webrtc:peer-left", {
          peerId: socket.id,
        });
        socket.leave(roomId);

        await cleanupCallRoom(roomId, socket.id);
      });

      // ── Disconnect Handler ─────────────────────────────────
      socket.on("disconnect", async () => {
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
          await cleanupCallRoom(roomId, socket.id);
        }
      });
    });

    res.socket.server.io = io;
  }

  res.end();
};

/**
 * Remove socket from a call room in Redis.
 * When the room becomes empty, log the call to SQLite CallHistory.
 */
async function cleanupCallRoom(roomId: string, socketId: string) {
  try {
    await redis.srem(`call:${roomId}`, socketId);
    const remaining = await redis.scard(`call:${roomId}`);

    if (remaining === 0) {
      // Room is empty → log completed call to SQLite
      const meta = await redis.hgetall(`call:${roomId}:meta`);
      await redis.del(`call:${roomId}`, `call:${roomId}:meta`);

      if (meta?.startTime) {
        const startTime = parseInt(meta.startTime, 10);
        const duration = Math.round((Date.now() - startTime) / 1000);

        try {
          await (db as any).callHistory.create({
            data: {
              callerId: "system",
              calleeId: "system",
              channelId: roomId,
              type: meta.type || "audio",
              roomId,
              duration,
              status: "ended",
              startedAt: new Date(startTime),
              endedAt: new Date(),
            },
          });
        } catch (dbErr) {
          console.error("[CallHistory] DB write error:", dbErr);
        }
      }
    }
  } catch (err) {
    console.error("[WebRTC] cleanupCallRoom error:", err);
  }
}

export default ioHandler;
