import ioHandler from "@/pages/api/socket/io";
import { NextApiRequest } from "next";

import { NextApiResponseServerIo } from "@/types";
import { currentProfilePages } from "@/lib/current-profile-pages";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { publicProfileSelect } from "@/lib/public-profile-select";
import { getLocalNodeId } from "@/lib/mesh-identity";
import { sendMeshControl } from "@/lib/mesh-control";

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

    // Check if recipient is online to set "DELIVERED" status
    let initialStatus = "SENT";
    try {
      const isOtherOnline = await redis.sismember("presence:online", otherMember.profileId);
      if (isOtherOnline) initialStatus = "DELIVERED";
    } catch (err) {
      // Gracefully fallback if Redis is not installed (e.g. Windows)
      console.warn("Redis unavailable, defaulting to SENT status");
    }

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
        status: initialStatus
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

    const channelKey = `chat:${conversationId}:messages`;
    if (!res.socket.server.io) { ioHandler(req, res); }
    res?.socket?.server?.io?.to(conversationId as string).emit(channelKey, message);

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

    if (meshPeer?.ipAddress) {
      sendMeshControl(meshPeer.ipAddress, {
        type: "direct_message_sync",
        fromNodeId: getLocalNodeId(),
        fromUserId: profile.id,
        fromUsername: profile.name,
        toUserId: otherMember.profile.id,
        toUsername: otherMember.profile.name,
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
          fromUsername: profile.name,
          toUsername: otherMember.profile.name,
        },
      }).catch((error) => {
        console.error("[DIRECT_MESSAGES_MESH_SYNC]", error);
      });
    }

    return res.status(200).json(message);
  } catch (error) {
    console.error("[DIRECT_MESSAGES_POST]", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
