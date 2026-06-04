import "server-only";

import fs from "fs";
import os from "os";
import path from "path";
import { getPreferredLanMac } from "@/lib/mesh-network";

type MeshSessionProfile = {
  id: string;
  userId: string;
  name: string;
  imageUrl?: string | null;
};

export const MESH_SESSION_FILE =
  process.env.MESH_SESSION_FILE ||
  path.join(process.cwd(), "private", "mesh-session.json");

export function persistMeshSession(profile: MeshSessionProfile) {
  fs.mkdirSync(path.dirname(MESH_SESSION_FILE), { recursive: true });
  const deviceMac = getLocalMac();
  fs.writeFileSync(
    MESH_SESSION_FILE,
    JSON.stringify(
      {
        profileId: profile.id,
        userId: profile.userId,
        username: profile.name,
        displayName: profile.name,
        avatarSeed: profile.imageUrl || profile.id,
        deviceMac,
        deviceName: os.hostname(),
        updatedAt: Date.now(),
      },
      null,
      2,
    ),
  );
}

function getLocalMac() {
  return getPreferredLanMac();
}

export function clearMeshSession() {
  try {
    fs.unlinkSync(MESH_SESSION_FILE);
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
}
