
import { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/lib/db";

function displayKey(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function isMeshContact(email?: string | null) {
  return String(email || "").toLowerCase().endsWith("@mesh.local");
}

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

    const deduped = Array.from(
      profiles.reduce((map, profile) => {
        const key = displayKey(profile.name);
        const existing = map.get(key);
        if (!existing || (isMeshContact(existing.email) && !isMeshContact(profile.email))) {
          map.set(key, profile);
        }
        return map;
      }, new Map<string, (typeof profiles)[number]>()).values()
    );

    return res.status(200).json(deduped);
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
}
