import { NextResponse } from "next/server";
import { z } from "zod";
import { currentProfile } from "@/lib/current-profile";
import { sendConnectionRequest } from "@/lib/mesh-handshake";

const schema = z.object({
  macAddress: z.string().min(1),
  message: z.string().max(240).optional(),
});

export async function POST(req: Request) {
  const profile = await currentProfile();
  if (!profile) return new NextResponse("Unauthorized", { status: 401 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Select a discovered peer before connecting" }, { status: 400 });
  }

  try {
    return NextResponse.json(await sendConnectionRequest(parsed.data.macAddress, parsed.data.message));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Handshake request failed" },
      { status: 400 },
    );
  }
}
