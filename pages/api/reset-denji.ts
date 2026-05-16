
import { NextApiRequest, NextApiResponse } from "next";
import * as crypto from "crypto";
import { db } from "@/lib/db";

// Must match app/api/auth/route.ts — PBKDF2-SHA512, 1000 iters, 64-byte key, userId as salt.
function hashPassword(password: string, salt: string) {
  return crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const name = "denji";
    const newPassword = "password123";

    const profile = await db.profile.findFirst({
      where: {
        name: {
          contains: name,
        }
      }
    });

    if (!profile) {
      return res.status(404).json({ message: `Profile "${name}" not found` });
    }

    const hashedPassword = hashPassword(newPassword, profile.userId);

    await db.profile.update({
      where: { id: profile.id },
      data: { password: hashedPassword }
    });

    return res.status(200).json({ message: `Password for "${profile.name}" reset to "${newPassword}"` });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error", error: String(error) });
  }
}
