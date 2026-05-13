import { db } from "@/lib/db";
import { NextApiRequest } from "next";

/**
 * Retrieves current profile from NextApiRequest (Pages Router)
 */
export const currentProfilePages = async (req: NextApiRequest) => {
  const userId = req.cookies["cyberdeck-user-id"];

  if (!userId) {
    return null;
  }
  
  const profile = await db.profile.findUnique({
    where: { userId }
  });

  return profile;
};
