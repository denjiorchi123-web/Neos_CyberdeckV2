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
  if (req.method !== "PATCH")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const profile = await currentProfilePages(req);
    const { conversationId } = req.query;

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

    const currentMember =
      conversation.memberOne.profileId === profile.id
        ? conversation.memberOne
        : conversation.memberTwo;

    // Update all messages in this conversation where:
    // 1. We are the recipient (message.memberId != currentMember.id)
    // 2. Status is not already "READ"
    const messagesToUpdate = await db.directMessage.findMany({
      where: {
        conversationId: conversationId as string,
        memberId: { not: currentMember.id },
        status: { not: "READ" }
      }
    });

    if (messagesToUpdate.length > 0) {
      await db.directMessage.updateMany({
        where: {
          id: { in: messagesToUpdate.map(m => m.id) }
        },
        data: {
          status: "READ"
        }
      });

      // Clear Redis cache for this conversation
      const redisKey = `cache:chat:${conversationId}:messages`;
      await redis.del(redisKey);

      // Notify the other member via Socket.io
      // We emit an update for each message or a generic "read" event
      // To keep it simple and consistent with existing logic, we emit an update for each
      const updateKey = `chat:${conversationId}:messages:update`;
      
      messagesToUpdate.forEach((msg) => {
        const updatedMsg = { ...msg, status: "READ", member: msg.memberId === conversation.memberOneId ? conversation.memberOne : conversation.memberTwo };
        if (!res.socket.server.io) { ioHandler(req, res); }
    res?.socket?.server?.io?.to(conversationId as string).emit(updateKey, updatedMsg);
      });

      console.log(`[READ_RECEIPTS] Marked ${messagesToUpdate.length} messages as READ in ${conversationId}`);
    }

    return res.status(200).json({ success: true, count: messagesToUpdate.length });
  } catch (error) {
    console.error("[DIRECT_MESSAGES_READ]", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
