import ioHandler from "@/pages/api/socket/io";
import { NextApiRequest } from "next";
import { createReadStream, existsSync } from "fs";
import { stat } from "fs/promises";
import { basename } from "path";
import { createHash } from "crypto";

import { NextApiResponseServerIo } from "@/types";
import { currentProfilePages } from "@/lib/current-profile-pages";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { publicProfileSelect } from "@/lib/public-profile-select";
import { getLocalNodeId } from "@/lib/mesh-identity";
import { sendMeshControl } from "@/lib/mesh-control";
import { resolveStoredFilePath } from "@/lib/media-dirs";

const MEDIA_CHUNK_BYTES = 96 * 1024;

async function sha256File(filePath: string) {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .once("error", reject)
      .once("end", resolve);
  });
  return hash.digest("hex");
}

function sha256Buffer(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function localUploadForUrl(fileUrl?: string | null) {
  if (!fileUrl || !fileUrl.startsWith("/api/files/")) return null;
  const filename = basename(fileUrl);
  if (!filename || filename.includes("..")) return null;
  return {
    filename,
    path: resolveStoredFilePath(filename),
  };
}

async function sendMeshMediaFile(
  ipAddress: string,
  context: {
    fromNodeId: string;
    fromUserId: string;
    fromUsername: string;
    toUsername: string;
    messageId: string;
  },
  fileUrl?: string | null,
  options: {
    fileName?: string | null;
    mimeType?: string | null;
    isThumbnail?: boolean;
  } = {},
) {
  const local = localUploadForUrl(fileUrl);
  if (!local || !existsSync(local.path)) return;

  const info = await stat(local.path);
  const totalChunks = Math.max(1, Math.ceil(info.size / MEDIA_CHUNK_BYTES));
  const fileSha256 = await sha256File(local.path);
  if (info.size === 0) {
    await sendMeshControl(ipAddress, {
      type: "direct_media_chunk",
      ...context,
      fileUrl,
      storageName: local.filename,
      fileName: options.fileName || local.filename,
      mimeType: options.mimeType || "application/octet-stream",
      isThumbnail: Boolean(options.isThumbnail),
      chunkIndex: 0,
      totalChunks,
      totalSize: 0,
      fileSha256,
      chunkSha256: sha256Buffer(Buffer.alloc(0)),
      dataBase64: "",
    });
    return;
  }

  let chunkIndex = 0;

  for await (const chunk of createReadStream(local.path, { highWaterMark: MEDIA_CHUNK_BYTES })) {
    const buffer = Buffer.from(chunk as Buffer);
    await sendMeshControl(ipAddress, {
      type: "direct_media_chunk",
      ...context,
      fileUrl,
      storageName: local.filename,
      fileName: options.fileName || local.filename,
      mimeType: options.mimeType || "application/octet-stream",
      isThumbnail: Boolean(options.isThumbnail),
      chunkIndex,
      totalChunks,
      totalSize: info.size,
      fileSha256,
      chunkSha256: sha256Buffer(buffer),
      dataBase64: buffer.toString("base64"),
    });
    chunkIndex += 1;
  }
}

async function sendMeshMediaForMessage(
  ipAddress: string,
  context: {
    fromNodeId: string;
    fromUserId: string;
    fromUsername: string;
    toUsername: string;
    messageId: string;
  },
  message: {
    fileUrl?: string | null;
    thumbnailUrl?: string | null;
    fileName?: string | null;
    mimeType?: string | null;
  },
) {
  await sendMeshMediaFile(ipAddress, context, message.fileUrl, {
    fileName: message.fileName,
    mimeType: message.mimeType,
  });
  await sendMeshMediaFile(ipAddress, context, message.thumbnailUrl, {
    fileName: message.fileName ? `Thumbnail for ${message.fileName}` : undefined,
    mimeType: "image/jpeg",
    isThumbnail: true,
  });
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponseServerIo
) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const profile = await currentProfilePages(req);
    const { content, fileUrl, fileName, fileSize, mimeType, thumbnailUrl, mediaKey, type, replyToId } = req.body;
    const { conversationId } = req.query;

    if (!profile) return res.status(401).json({ error: "Unauthorized" });

    if (!conversationId)
      return res.status(400).json({ error: "Conversation ID Missing" });

    if (!content)
      return res.status(400).json({ error: "Content Missing" });

    const conversation = await db.conversation.findFirst({
      where: {
        id: conversationId as string,
        OR: [
          { memberOne: { profileId: profile.id } },
          { memberTwo: { profileId: profile.id } }
        ]
      },
      include: {
        memberOne: {
          include: { profile: { select: publicProfileSelect } }
        },
        memberTwo: {
          include: { profile: { select: publicProfileSelect } }
        }
      }
    });

    if (!conversation)
      return res.status(404).json({ error: "Conversation not found" });

    const member =
      conversation.memberOne.profileId === profile.id
        ? conversation.memberOne
        : conversation.memberTwo;
        
    const otherMember = 
      conversation.memberOne.profileId === profile.id
        ? conversation.memberTwo
        : conversation.memberOne;

    if (!member)
      return res.status(404).json({ message: "Member not found" });

    // Block Guard
    const isBlocked = await db.blockedUser.findFirst({
      where: {
        OR: [
          { blockerId: profile.id, blockedId: otherMember.profileId },
          { blockerId: otherMember.profileId, blockedId: profile.id }
        ]
      }
    });

    if (isBlocked) {
      return res.status(403).json({ error: "Message blocked by recipient preferences." });
    }

    const activeThreshold = new Date(Date.now() - 15 * 1000);
    const meshPeer = await db.meshPeer.findFirst({
      where: {
        status: { in: ["TRUSTED", "ACCEPTED"] },
        OR: [
          { userId: otherMember.profile.id },
          { publicName: otherMember.profile.name },
        ],
        ipAddress: { not: null },
        lastSeen: { gte: activeThreshold },
      },
    });

    // Check if recipient is online to set "DELIVERED" status.
    // Mesh messages must stay SENT until the peer ACKs them; otherwise a
    // mid-transfer cable cut can hide a failed media delivery from retry sync.
    let initialStatus = "SENT";
    try {
      const isOtherOnline = await redis.sismember("presence:online", otherMember.profileId);
      if (isOtherOnline && !meshPeer?.ipAddress) initialStatus = "DELIVERED";
    } catch (err) {
      // Gracefully fallback if Redis is not installed (e.g. Windows)
      console.warn("Redis unavailable, defaulting to SENT status");
    }

    const maxSeq = await db.directMessage.aggregate({
      where: { conversationId: conversationId as string },
      _max: { seqId: true }
    });
    const nextSeq = (maxSeq._max.seqId ?? 0) + 1;

    const message = await db.directMessage.create({
      data: {
        content,
        fileUrl:      fileUrl      ?? undefined,
        fileName:     fileName     ?? undefined,
        fileSize:     fileSize     ? Number(fileSize) : undefined,
        mimeType:     mimeType     ?? undefined,
        thumbnailUrl: thumbnailUrl ?? undefined,
        mediaKey:     mediaKey     ?? undefined,
        type:         type         ?? "TEXT",
        replyToId:    replyToId    ?? undefined,
        conversationId: conversationId as string,
        memberId: member.id,
        status: initialStatus,
        createdAt: new Date(),
        seqId: nextSeq,
        senderSeqId: nextSeq
      },
      include: {
        member: {
          include: {
            profile: { select: publicProfileSelect }
          }
        },
        replyTo: {
          include: {
            member: {
              include: {
                profile: { select: publicProfileSelect }
              }
            }
          }
        }
      }
    });

    // Flush WAL to disk in the background so it doesn't block the main thread
    db.$executeRawUnsafe("PRAGMA wal_checkpoint(FULL);").catch(() => {});

    const channelKey = `chat:${conversationId}:messages`;
    const io = res?.socket?.server?.io || (global as any).nextIo;
    if (!io) { ioHandler(req, res); }
    (res?.socket?.server?.io || (global as any).nextIo)?.to(conversationId as string).emit(channelKey, message);

    if (meshPeer?.ipAddress) {
      const meshContext = {
        fromNodeId: getLocalNodeId(),
        fromUserId: profile.id,
        fromUsername: profile.name,
        toUsername: otherMember.profile.name,
        messageId: message.id,
      };

      (async () => {
        await sendMeshMediaForMessage(meshPeer.ipAddress!, meshContext, {
          fileUrl: message.fileUrl,
          thumbnailUrl: (message as any).thumbnailUrl,
          fileName: (message as any).fileName,
          mimeType: (message as any).mimeType,
        });

        await sendMeshControl(meshPeer.ipAddress!, {
          type: "direct_message_sync",
          fromNodeId: meshContext.fromNodeId,
          fromUserId: meshContext.fromUserId,
          fromUsername: meshContext.fromUsername,
          toUserId: otherMember.profile.id,
          toUsername: meshContext.toUsername,
          message: {
            id: message.id,
            content: message.content,
            type: message.type,
            fileUrl: message.fileUrl,
            fileName: (message as any).fileName,
            fileSize: (message as any).fileSize,
            mimeType: (message as any).mimeType,
            thumbnailUrl: (message as any).thumbnailUrl,
            mediaKey: (message as any).mediaKey,
            createdAt: message.createdAt.toISOString(),
            seqId: message.seqId,
            fromUsername: profile.name,
            toUsername: otherMember.profile.name,
          },
        });
      })().catch((error) => {
        console.error("[DIRECT_MESSAGES_MESH_SYNC]", error);
      });
    }

    return res.status(200).json(message);
  } catch (error) {
    console.error("[DIRECT_MESSAGES_POST]", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
