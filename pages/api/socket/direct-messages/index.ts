import ioHandler from "@/pages/api/socket/io";
import { NextApiRequest } from "next";

import { NextApiResponseServerIo } from "@/types";
import { currentProfilePages } from "@/lib/current-profile-pages";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { publicProfileSelect } from "@/lib/public-profile-select";

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
    const activeThreshold = new Date(Date.now() - 15 * 1000);

    const [isBlocked, meshPeer, maxSeq, isOtherOnline] = await Promise.all([
      db.blockedUser.findFirst({
        where: {
          OR: [
            { blockerId: profile.id, blockedId: otherMember.profileId },
            { blockerId: otherMember.profileId, blockedId: profile.id }
          ]
        }
      }),
      db.meshPeer.findFirst({
        where: {
          status: { in: ["TRUSTED", "ACCEPTED"] },
          OR: [
            { userId: otherMember.profile.id },
            { publicName: otherMember.profile.name },
          ],
          ipAddress: { not: null },
          lastSeen: { gte: activeThreshold },
        },
      }),
      db.directMessage.aggregate({
        where: { conversationId: conversationId as string },
        _max: { seqId: true }
      }),
      (async () => {
        try {
          return await redis.sismember("presence:online", otherMember.profileId);
        } catch (err) {
          console.warn("Redis unavailable, defaulting to SENT status");
          return false;
        }
      })()
    ]);

    if (isBlocked) {
      return res.status(403).json({ error: "Message blocked by recipient preferences." });
    }

    // Check if recipient is online to set "DELIVERED" status.
    // Mesh messages must stay SENT until the peer ACKs them; otherwise a
    // mid-transfer cable cut can hide a failed media delivery from retry sync.
    let initialStatus = "SENT";
    if (isOtherOnline && !meshPeer?.ipAddress) {
      initialStatus = "DELIVERED";
    }

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

    // The native mesh outbox is the single delivery owner. Sending here as
    // well races the UDP-triggered outbox and can make several writers append
    // the same attachment chunks to one partial file.

    return res.status(200).json(message);
  } catch (error) {
    console.error("[DIRECT_MESSAGES_POST]", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
