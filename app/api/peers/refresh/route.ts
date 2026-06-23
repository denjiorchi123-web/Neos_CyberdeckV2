import { NextResponse } from "next/server";
import { z } from "zod";
import { currentProfile } from "@/lib/current-profile";
import { redisPub } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  targetIp: z.string().trim().max(64).optional(),
});

export async function POST(req: Request) {
  const profile = await currentProfile();
  if (!profile) return new NextResponse("Unauthorized", { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid discovery request" }, { status: 400 });
  }

  try {
    const receivers = await redisPub.publish(
      "mesh:discovery:refresh",
      JSON.stringify({ targetIp: parsed.data.targetIp || "", requestedAt: Date.now() }),
    );
    if (receivers < 1) {
      return NextResponse.json({ error: "Mesh discovery service is unavailable" }, { status: 503 });
    }
    return NextResponse.json(
      { scanning: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not start LAN discovery" },
      { status: 503 },
    );
  }
}
