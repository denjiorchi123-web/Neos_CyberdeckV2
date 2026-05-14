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

    // Check Redis for active call status
    const isBusy = await redis.get(`user:${userId}:busy`);

    return res.status(200).json({ isBusy: !!isBusy });
  } catch (error) {
    console.log("[BUSY_CHECK_GET]", error);
    return res.status(500).json({ error: "Internal Error" });
  }
}
