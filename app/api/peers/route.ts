import { NextResponse } from "next/server";
import os from "os";
import { discoverPeers } from "@/lib/peer-discovery";

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

export async function GET() {
  const peers = await discoverPeers();
  return NextResponse.json({
    self: {
      hostname: os.hostname(),
    },
    peers,
  });
}
