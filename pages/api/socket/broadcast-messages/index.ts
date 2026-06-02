import ioHandler from "@/pages/api/socket/io";
import { NextApiRequest } from "next";
import { NextApiResponseServerIo } from "@/types";
import { currentProfilePages } from "@/lib/current-profile-pages";
import { db } from "@/lib/db";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponseServerIo
) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const profile = await currentProfilePages(req);
    const { content, fileUrl, type } = req.body;
    const { broadcastId } = req.query;

    if (!profile) return res.status(401).json({ error: "Unauthorized" });
    if (!broadcastId) return res.status(400).json({ error: "Broadcast ID Missing" });
    if (!content) return res.status(400).json({ error: "Content Missing" });

    const broadcastChannel = await db.broadcastChannel.findFirst({
      where: {
        id: broadcastId as string,
        followers: {
          some: {
            profileId: profile.id,
            role: "ADMIN" // ONLY Admins can send messages to a Broadcast Channel
          }
        }
      },
      include: {
        followers: true
      }
    });

    if (!broadcastChannel)
      return res.status(404).json({ message: "Channel not found or you are not an Admin" });

    const message = await db.broadcastMessage.create({
      data: {
        content,
        fileUrl: fileUrl ?? undefined,
        type: type ?? "TEXT",
        channel: {
          connect: { id: broadcastId as string }
        }
      }
    });

    // To mimic standard chat, we also need to attach the profile info so UI can render the avatar
    // For BroadcastMessage, we don't store memberId, we just store the message. But wait, how does UI know who sent it?
    // Usually broadcasts just come from "The Channel", but if multiple admins exist, maybe they want to see who sent it.
    // Our schema for BroadcastMessage:
    // model BroadcastMessage {
    //   id         String @id @default(uuid())
    //   content    String
    //   type       String @default("TEXT")
    //   fileUrl    String?
    //   broadcastChannelId String
    //   broadcastChannel   BroadcastChannel @relation(fields: [broadcastChannelId], references: [id], onDelete: Cascade)
    //   createdAt  DateTime @default(now())
    // }
    // There is no profileId attached to a BroadcastMessage! So the UI will just render it as from the "Community".
    // We will spoof the member object for the socket payload so `ChatMessages` doesn't crash.

    const messageWithSpoofedMember = {
      ...message,
      member: {
        id: "admin",
        role: "ADMIN",
        profile: {
          id: broadcastChannel.profileId,
          name: broadcastChannel.name,
          imageUrl: broadcastChannel.imageUrl || ""
        }
      }
    };

    const channelKey = `chat:${broadcastId}:messages`;

    if (!res.socket.server.io) { ioHandler(req, res); }
    res?.socket?.server?.io?.to(broadcastId as string).emit(channelKey, messageWithSpoofedMember);

    return res.status(200).json(message);
  } catch (error) {
    console.error("[BROADCAST_MESSAGES_POST]", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
