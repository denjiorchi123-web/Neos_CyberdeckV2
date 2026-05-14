import { NextApiRequest, NextApiResponse } from "next";
import { redis } from "@/lib/redis";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { userId } = req.query;

    if (!userId || typeof userId !== "string") {
      return res.status(400).json({ error: "User ID missing" });
    }

    const lastSeen = await redis.get(`user:${userId}:presence`);

    return res.status(200).json({ 
      isOnline: !!lastSeen,
      lastSeen: lastSeen ? new Date(parseInt(lastSeen)) : null
    });
  } catch (error) {
    console.log("[PRESENCE_GET]", error);
    return res.status(500).json({ error: "Internal Error" });
  }
}
