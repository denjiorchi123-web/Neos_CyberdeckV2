import "server-only";

import os from "os";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { getLocalIp, getLocalNodeId, MESH_CONTROL_PORT } from "@/lib/mesh-identity";
import { sendMeshControl } from "@/lib/mesh-control";

const REQUEST_TTL_MS = 5 * 60 * 1000;

type MeshProfileIdentity = {
  id: string;
  name: string;
};

export async function sendConnectionRequest(
  profile: MeshProfileIdentity,
  peerNodeId: string,
  message?: string,
) {
  const peer = await db.meshPeer.findUnique({ where: { macAddress: peerNodeId } });
  if (!peer?.ipAddress) throw new Error("Peer must be discovered before requesting a connection");
  if (peer.status === "BLOCKED") throw new Error("Blocked peers cannot receive requests");
  if (!profile.name?.trim()) throw new Error("Cannot send mesh identity without a logged-in username");

  const requestId = randomUUID();
  const localNodeId = getLocalNodeId();
  const expiresAt = new Date(Date.now() + REQUEST_TTL_MS);

  await db.$transaction([
    db.connectionRequest.create({
      data: {
        requestId,
        fromNodeId: localNodeId,
        toNodeId: peerNodeId,
        direction: "OUTGOING",
        status: "PENDING",
        message,
        expiresAt,
      },
    }),
    db.meshPeer.update({
      where: { macAddress: peerNodeId },
      data: { status: "PENDING_OUTGOING", lastHandshake: new Date() },
    }),
  ]);

  await sendMeshControl(peer.ipAddress, {
    type: "connection_request",
    requestId,
    fromNodeId: localNodeId,
    fromUserId: profile.id,
    fromUsername: profile.name,
    fromHostname: os.hostname(),
    fromPublicName: profile.name,
    fromDeviceName: os.hostname(),
    fromIp: getLocalIp(),
    message: message || `${profile.name} wants to connect`,
    expiresAt: expiresAt.getTime(),
  });

  return { requestId, expiresAt };
}

export async function respondToConnectionRequest(
  profile: MeshProfileIdentity,
  requestId: string,
  action: "ACCEPTED" | "DECLINED" | "IGNORED" | "BLOCKED",
) {
  if (!profile.name?.trim()) throw new Error("Cannot answer mesh identity without a logged-in username");

  const request = await db.connectionRequest.findUnique({ where: { requestId } });
  if (!request || request.direction !== "INCOMING") throw new Error("Incoming request not found");
  if (request.status !== "PENDING") throw new Error("Request has already been answered");
  if (request.expiresAt.getTime() < Date.now()) throw new Error("Request has expired");

  const peer = await db.meshPeer.findUnique({ where: { macAddress: request.fromNodeId } });
  if (!peer?.ipAddress) throw new Error("Peer address is unavailable");

  const peerStatus =
    action === "ACCEPTED" ? "TRUSTED" :
    action === "BLOCKED" ? "BLOCKED" :
    action === "DECLINED" ? "DECLINED" : "UNKNOWN";
  const existingSession = action === "ACCEPTED"
    ? await db.peerSession.findFirst({ where: { peerNodeId: request.fromNodeId } })
    : null;

  const operations: any[] = [
    db.connectionRequest.update({
      where: { requestId },
      data: { status: action, respondedAt: new Date() },
    }),
    db.meshPeer.update({
      where: { macAddress: request.fromNodeId },
      data: { status: peerStatus, lastHandshake: new Date() },
    }),
    db.meshEvent.create({
      data: {
        originNodeId: getLocalNodeId(),
        entityType: "connection_request",
        entityId: requestId,
        operation: `handshake_${action.toLowerCase()}`,
        payloadJson: JSON.stringify({ peerNodeId: request.fromNodeId, action }),
      },
    }),
  ];

  if (action === "ACCEPTED") {
    operations.push(
      db.meshDevice.upsert({
        where: {
          ownerId_macAddress: {
            ownerId: peer.userId || request.fromNodeId,
            macAddress: request.fromNodeId,
          },
        },
        update: {
          deviceName: peer.hostname || undefined,
          approvedAt: new Date(),
          approvedBy: getLocalNodeId(),
        },
        create: {
          ownerId: peer.userId || request.fromNodeId,
          macAddress: request.fromNodeId,
          deviceName: peer.hostname || undefined,
          approvedAt: new Date(),
          approvedBy: getLocalNodeId(),
        },
      }),
      existingSession
        ? db.peerSession.update({
            where: { sessionId: existingSession.sessionId },
            data: {
              state: "CONNECTED",
              lastConnected: new Date(),
              transportIp: peer.ipAddress,
              transportPort: MESH_CONTROL_PORT,
            },
          })
        : db.peerSession.create({
            data: {
              peerNodeId: request.fromNodeId,
              state: "CONNECTED",
              lastConnected: new Date(),
              transportIp: peer.ipAddress,
              transportPort: MESH_CONTROL_PORT,
            },
          }),
      db.syncState.upsert({
        where: { peerNodeId: request.fromNodeId },
        update: {},
        create: { peerNodeId: request.fromNodeId },
      }),
    );
  } else if (action === "BLOCKED") {
    operations.push(
      db.meshBlocklist.upsert({
        where: { macAddress: request.fromNodeId },
        update: { reason: "blocked_by_local_user" },
        create: { macAddress: request.fromNodeId, reason: "blocked_by_local_user" },
      }),
    );
  }

  await db.$transaction(operations);
  await sendMeshControl(peer.ipAddress, {
    type: "connection_response",
    requestId,
    fromNodeId: getLocalNodeId(),
    fromUserId: profile.id,
    fromUsername: profile.name,
    fromPublicName: profile.name,
    fromDeviceName: os.hostname(),
    status: action,
  });

  return { requestId, status: action };
}
