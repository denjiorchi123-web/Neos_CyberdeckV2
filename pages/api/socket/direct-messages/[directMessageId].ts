import ioHandler from "@/pages/api/socket/io";
import { NextApiRequest } from "next";
import { MemberRole } from "@/lib/db";

import { NextApiResponseServerIo } from "@/types";
import { currentProfilePages } from "@/lib/current-profile-pages";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { publicProfileSelect } from "@/lib/public-profile-select";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponseServerIo
) {
  if (req.method !== "DELETE" && req.method !== "PATCH")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const profile = await currentProfilePages(req);
    const { content, isPinned } = req.body;
    const { directMessageId, conversationId } = req.query;

    if (!profile) return res.status(401).json({ error: "Unauthorized" });

    if (!conversationId)
      return res.status(400).json({ error: "Conversation ID Missing" });

    const conversation = await db.conversation.findFirst({
      where: {
        id: conversationId as string,
        OR: [
          { memberOne: { profileId: profile.id } },
          { memberTwo: { profileId: profile.id } }
        ]
      },
      include: {
        memberOne: { include: { profile: { select: publicProfileSelect } } },
        memberTwo: { include: { profile: { select: publicProfileSelect } } }
      }
    });

    if (!conversation)
      return res.status(404).json({ error: "Conversation not found" });

    const member =
      conversation.memberOne.profileId === profile.id
        ? conversation.memberOne
        : conversation.memberTwo;

    if (!member)
      return res.status(404).json({ error: "Member not found" });

    let directMessage = await db.directMessage.findFirst({
      where: {
        id: directMessageId as string,
        conversationId: conversationId as string
      },
      include: {
        member: {
          include: {
            profile: { select: publicProfileSelect }
          }
        }
      }
    });

    if (!directMessage || directMessage.deleted)
      return res.status(404).json({ error: "Message not found" });

    const isMessageOwner = directMessage.memberId === member.id;
    const isAdmin = member.role === MemberRole.ADMIN;
    const isModerator = member.role === MemberRole.MODERATOR;
    const canModify = isMessageOwner || isAdmin || isModerator;

    if (!canModify && req.method === "DELETE") return res.status(401).json({ error: "Unauthorized" });

    if (req.method === "DELETE") {
      directMessage = await db.directMessage.update({
        where: { id: directMessageId as string },
        data: {
          fileUrl: null,
          content: "This message has been deleted.",
          deleted: true
        },
        include: {
          member: { include: { profile: { select: publicProfileSelect } } }
        }
      });
    }

    if (req.method === "PATCH") {
      // For pinning: allow any conversation participant. For content edits: restrict to owner.
      const isPinOnly = isPinned !== undefined && content === undefined;
      
      if (!isPinOnly && !canModify) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      if (content !== undefined && !isMessageOwner) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const updateData: any = {};
      if (content !== undefined) updateData.content = content;
      if (isPinned !== undefined) updateData.isPinned = isPinned;

      directMessage = await db.directMessage.update({
        where: { id: directMessageId as string },
        data: updateData,
        include: {
          member: { include: { profile: { select: publicProfileSelect } } }
        }
      });
    }

    // ── Redis Cache Sync ──────────────────────────────────────
    // Purge the Redis cache for this conversation to force a fresh DB load on refresh
    const redisKey = `cache:chat:${conversationId}:messages`;
    try {
      await redis.del(redisKey);
    } catch (redisErr) {
      console.error("[Redis Purge Error]", redisErr);
    }

    const updateKey = `chat:${conversationId}:messages:update`;
    if (!res.socket.server.io) { ioHandler(req, res); }
    res?.socket?.server?.io?.emit(updateKey, directMessage);

    return res.status(200).json(directMessage);
  } catch (error) {
    console.error("[MESSAGES_ID]", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
