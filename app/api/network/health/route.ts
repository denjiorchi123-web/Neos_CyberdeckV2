import { NextResponse } from "next/server";
import os from "os";
import { getLocalIp, getLocalNodeId } from "@/lib/mesh-identity";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({
      ip: getLocalIp(),
      mac: getLocalNodeId(),
      hostname: os.hostname(),
      timestamp: Date.now() / 1000
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch health" }, { status: 500 });
  }
}
