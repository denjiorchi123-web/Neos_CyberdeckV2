import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentProfile } from "@/lib/current-profile";

// Scenario #14: MediaRoom calls this every 30s with the latest getStats() sample.
// Writes are best-effort — a DB hiccup never interrupts the call.
export async function POST(req: Request) {
  try {
    const profile = await currentProfile();
    if (!profile) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const body = await req.json();
    const callId = String(body?.callId || "").trim();
    if (!callId) {
      return new NextResponse("callId required", { status: 400 });
    }
    await (db as any).callQualityLog.create({
      data: {
        callId,
        packetLoss: Number(body.packetLoss) || 0,
        jitter: Number(body.jitter) || 0,
        roundTripTime: Number(body.roundTripTime) || 0,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[CallQuality] write failed:", error);
    return new NextResponse("Internal error", { status: 500 });
  }
}
