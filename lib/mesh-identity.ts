import crypto from "crypto";
import os from "os";

export const MESH_CONTROL_PORT = Number(process.env.MESH_CONTROL_PORT || 5006);
export const MESH_SECRET = process.env.MESH_SECRET || "GHOSTWIRE_ALPHA_7";

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
  return {
    payload: body,
    sig: crypto.createHmac("sha256", MESH_SECRET).update(body).digest("hex"),
  };
}
