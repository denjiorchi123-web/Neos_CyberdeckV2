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

function meshSessionPayload(profile: MeshSessionProfile) {
  const deviceMac = getLocalMac();
  return {
    profileId: profile.id,
    userId: profile.userId,
    username: profile.name,
    displayName: profile.name,
    avatarSeed: profile.imageUrl || profile.id,
    deviceMac,
    deviceName: os.hostname(),
    updatedAt: Date.now(),
  };
}

function writeMeshSession(profile: MeshSessionProfile) {
  fs.mkdirSync(path.dirname(MESH_SESSION_FILE), { recursive: true });
  fs.writeFileSync(
    MESH_SESSION_FILE,
    JSON.stringify(meshSessionPayload(profile), null, 2),
  );
  try {
    fs.chmodSync(MESH_SESSION_FILE, 0o600);
  } catch {}
}

export function persistMeshSession(profile: MeshSessionProfile) {
  writeMeshSession(profile);
}

export function syncMeshSession(profile: MeshSessionProfile | null | undefined) {
  if (!profile?.id || !profile?.userId || !profile?.name?.trim()) return;
  try {
    const current = JSON.parse(fs.readFileSync(MESH_SESSION_FILE, "utf8"));
    if (
      current?.profileId === profile.id &&
      current?.userId === profile.userId &&
      current?.username === profile.name &&
      current?.displayName === profile.name
    ) {
      return;
    }
  } catch {}

  writeMeshSession(profile);
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
