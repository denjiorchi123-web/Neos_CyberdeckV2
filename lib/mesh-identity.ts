import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

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
  for (const interfaces of Object.values(os.networkInterfaces())) {
    const hasCableIp = (interfaces || []).some(
      (iface) => !iface.internal && iface.family === "IPv4" && iface.address.startsWith("192.168.10."),
    );
    if (!hasCableIp) continue;
    for (const iface of interfaces || []) {
      if (!iface.internal && iface.mac && iface.mac !== "00:00:00:00:00:00") {
        return iface.mac.replace(/:/g, "").toLowerCase();
      }
    }
  }

  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const iface of interfaces || []) {
      if (!iface.internal && iface.mac && iface.mac !== "00:00:00:00:00:00") {
        return iface.mac.replace(/:/g, "").toLowerCase();
      }
    }
  }
  return `node-${os.hostname().toLowerCase()}`;
}

export function getLocalIps(): string[] {
  const ips: string[] = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const iface of interfaces || []) {
      if (!iface.internal && iface.family === "IPv4") ips.push(iface.address);
    }
  }
  return ips;
}

export function getLocalIp(): string {
  const ips = getLocalIps();
  return ips.find((ip) => ip.startsWith("192.168.10.")) || ips[0] || "127.0.0.1";
}

export function isDirectEthernetReady(): boolean {
  return getLocalIps().some((ip) => ip === "192.168.10.1" || ip === "192.168.10.2");
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
