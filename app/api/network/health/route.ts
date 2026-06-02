import { NextResponse } from "next/server";
import os from "os";

export const dynamic = "force-dynamic";

function getLocalMac() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const ifaces = interfaces[name];
    if (!ifaces) continue;
    for (const iface of ifaces) {
      if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
        return iface.mac.replace(/:/g, '').toLowerCase();
      }
    }
  }
  return `mock_${Math.floor(Math.random() * 9000) + 1000}`;
}

export async function GET() {
  try {
    const interfaces = os.networkInterfaces();
    let localIp = "127.0.0.1";
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (!iface.internal && iface.family === 'IPv4') {
          localIp = iface.address;
          break;
        }
      }
    }

    return NextResponse.json({
      ip: localIp,
      mac: getLocalMac(),
      hostname: os.hostname(),
      timestamp: Date.now() / 1000
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch health" }, { status: 500 });
  }
}
