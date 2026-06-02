import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const requestId = new URL(req.url).searchParams.get("requestId");
  const requests = await db.connectionRequest.findMany({
    where: requestId ? { requestId } : { direction: "INCOMING", status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });

  const enriched = await Promise.all(requests.map(async (request) => {
    const peerNodeId = request.direction === "INCOMING" ? request.fromNodeId : request.toNodeId;
    const peer = await db.meshPeer.findUnique({ where: { macAddress: peerNodeId } });
    return {
      requestId: request.requestId,
      fromNodeId: request.fromNodeId,
      toNodeId: request.toNodeId,
      direction: request.direction,
      status: request.status,
      message: request.message,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
      hostname: peer?.hostname,
      publicName: peer?.publicName,
      ipAddress: peer?.ipAddress,
      trustStatus: peer?.status,
    };
  }));

  return NextResponse.json(enriched);
}
