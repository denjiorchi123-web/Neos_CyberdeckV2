import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  getLanIps,
  getLocalIps as getAllLocalIps,
  getPreferredLanIp,
  getPreferredLanMac,
  isLanReady,
} from "@/lib/mesh-network";

export const MESH_CONTROL_PORT = Number(process.env.MESH_CONTROL_PORT || 5006);
function loadMeshSecret() {
  if (process.env.MESH_SECRET?.trim()) return process.env.MESH_SECRET.trim();
  const secretFile = process.env.MESH_SECRET_FILE || path.join(process.cwd(), "private", "mesh-secret.key");
  try {
    const secret = fs.readFileSync(secretFile, "utf8").trim();
    if (secret.length >= 32) return secret;
  } catch {}
  return "GHOSTWIRE_ALPHA_7";
}

export const MESH_SECRET = loadMeshSecret();
const CONTROL_ENCRYPTION = process.env.MESH_CONTROL_ENCRYPTION !== "0";

export function getLocalNodeId(): string {
  return getPreferredLanMac() || `node-${getLocalIp().replace(/\W/g, "").toLowerCase()}`;
}

export function getLocalIps(): string[] {
  return getAllLocalIps();
}

export function getLocalIp(): string {
  return getPreferredLanIp();
}

export function isDirectEthernetReady(): boolean {
  return isLanReady() || getLanIps().length > 0;
}

export function signedControlMessage(payload: Record<string, unknown>) {
  const body = JSON.stringify({ ...payload, timestamp: Date.now() });
  if (CONTROL_ENCRYPTION) {
    const iv = crypto.randomBytes(12);
    const key = crypto.createHash("sha256").update(`cyberdeck-control:${MESH_SECRET}`).digest();
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(body, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const signed = `${iv.toString("base64")}:${ciphertext.toString("base64")}:${tag.toString("base64")}`;
    return {
      enc: "aes-256-gcm",
      iv: iv.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      tag: tag.toString("base64"),
      sig: crypto.createHmac("sha256", MESH_SECRET).update(signed).digest("hex"),
    };
  }

  return {
    payload: body,
    sig: crypto.createHmac("sha256", MESH_SECRET).update(body).digest("hex"),
  };
}
