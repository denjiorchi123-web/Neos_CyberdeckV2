import "server-only";

import fs from "fs";
import path from "path";

type MeshSessionProfile = {
  id: string;
  userId: string;
  name: string;
};

export const MESH_SESSION_FILE =
  process.env.MESH_SESSION_FILE ||
  path.join(process.cwd(), "private", "mesh-session.json");

export function persistMeshSession(profile: MeshSessionProfile) {
  fs.mkdirSync(path.dirname(MESH_SESSION_FILE), { recursive: true });
  fs.writeFileSync(
    MESH_SESSION_FILE,
    JSON.stringify(
      {
        profileId: profile.id,
        userId: profile.userId,
        username: profile.name,
        updatedAt: Date.now(),
      },
      null,
      2,
    ),
  );
}

export function clearMeshSession() {
  try {
    fs.unlinkSync(MESH_SESSION_FILE);
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
}
