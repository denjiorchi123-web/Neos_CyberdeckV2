import { NextResponse } from "next/server";
import { z } from "zod";
import { currentProfile } from "@/lib/current-profile";
import { respondToConnectionRequest } from "@/lib/mesh-handshake";

const schema = z.object({
  requestId: z.string().uuid(),
  action: z.enum(["ACCEPTED", "DECLINED", "IGNORED", "BLOCKED"]),
});

export async function POST(req: Request) {
  const profile = await currentProfile();
  if (!profile) return new NextResponse("Unauthorized", { status: 401 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid response" }, { status: 400 });

  try {
    return NextResponse.json(
      await respondToConnectionRequest(profile, parsed.data.requestId, parsed.data.action),
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Handshake failed" }, { status: 400 });
  }
}
