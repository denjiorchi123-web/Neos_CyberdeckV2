import { NextResponse } from "next/server";
import { z } from "zod";
import { currentProfile } from "@/lib/current-profile";
import { sendConnectionRequest, sendConnectionRequestToIp } from "@/lib/mesh-handshake";

const schema = z.object({
  macAddress: z.string().min(1).optional(),
  ipAddress: z.string().min(7).max(64).optional(),
  message: z.string().max(240).optional(),
}).refine((value) => Boolean(value.macAddress || value.ipAddress), {
  message: "Select a discovered peer or enter a peer IP address",
});

function cleanIpAddress(value: string) {
  return value.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").split(":")[0];
}

function isUsableIPv4(value: string) {
  const parts = value.split(".").map(Number);
  return (
    parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
    value !== "0.0.0.0" &&
    value !== "255.255.255.255" &&
    parts[0] !== 127
  );
}

export async function POST(req: Request) {
  const profile = await currentProfile();
  if (!profile) return new NextResponse("Unauthorized", { status: 401 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Select a discovered peer or enter a peer IP address" }, { status: 400 });
  }

  try {
    if (parsed.data.macAddress) {
      return NextResponse.json(
        await sendConnectionRequest(profile, parsed.data.macAddress, parsed.data.message),
      );
    }

    const ipAddress = cleanIpAddress(parsed.data.ipAddress || "");
    if (!isUsableIPv4(ipAddress)) {
      return NextResponse.json({ error: "Enter a valid LAN IPv4 address" }, { status: 400 });
    }

    return NextResponse.json(
      await sendConnectionRequestToIp(profile, ipAddress, parsed.data.message),
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Handshake request failed" },
      { status: 400 },
    );
  }
}
