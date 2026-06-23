import { NextResponse } from "next/server";
import { z } from "zod";
import { currentProfile } from "@/lib/current-profile";
import { sendConnectionRequest, sendConnectionRequestToIp } from "@/lib/mesh-handshake";
import { db } from "@/lib/db";
import { redisPub } from "@/lib/redis";

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

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function discoverPeerAtIp(ipAddress: string) {
  await redisPub.publish(
    "mesh:discovery:refresh",
    JSON.stringify({ targetIp: ipAddress, requestedAt: Date.now() }),
  );

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const peer = await db.meshPeer.findFirst({
      where: {
        ipAddress,
        lastSeen: { gte: new Date(Date.now() - 30_000) },
        status: { not: "BLOCKED" },
      },
      orderBy: { lastSeen: "desc" },
    });
    if (peer) return peer;
    await wait(250);
  }
  return null;
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

    // Prefer the real hardware identity discovered by a targeted HELLO probe.
    // TCP remains the fallback when a peer blocks UDP discovery.
    const discoveredPeer = await discoverPeerAtIp(ipAddress);
    if (discoveredPeer) {
      return NextResponse.json({
        ...(await sendConnectionRequest(profile, discoveredPeer.macAddress, parsed.data.message)),
        discovered: true,
        peerNodeId: discoveredPeer.macAddress,
        targetIp: ipAddress,
      });
    }

    return NextResponse.json(
      {
        ...(await sendConnectionRequestToIp(profile, ipAddress, parsed.data.message)),
        discovered: false,
      },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Handshake request failed" },
      { status: 400 },
    );
  }
}
