
import { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/lib/db";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const profiles = await db.profile.findMany({
      select: {
        name: true,
        email: true
      }
    });

    return res.status(200).json(profiles);
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
}
