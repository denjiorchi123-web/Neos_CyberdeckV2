import "server-only";

import os from "os";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { getLocalIp, getLocalNodeId, MESH_CONTROL_PORT } from "@/lib/mesh-identity";
import { sendMeshControl } from "@/lib/mesh-control";
import { ensureAcceptedMeshContact, ensureDirectConversationForAcceptedPeer } from "@/lib/mesh-contacts";
import {
  ensureTrustedPeerTables,
  logRejectedPeer,
  normalizeSecurityStatus,
  readConnectionRequestPayload,
  VERIFIED_LAN_STATUS,
  writeTrustedPeer,
} from "@/lib/trusted-peers";

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
    db.meshPeer.upsert({
      where: { macAddress: peerNodeId },
      update: { status: "PENDING_OUTGOING", lastHandshake: new Date(), ipAddress: peer.ipAddress },
      create: {
        macAddress: peerNodeId,
        userId: peer.userId || null,
        hostname: peer.hostname || null,
        ipAddress: peer.ipAddress,
        publicName: peer.publicName || null,
        displayName: peer.displayName || peer.publicName || null,
        status: "PENDING_OUTGOING",
        lastHandshake: new Date(),
      },
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
    securityStatus: VERIFIED_LAN_STATUS,
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

  await ensureTrustedPeerTables(db as any);

  const peer = await db.meshPeer.findUnique({ where: { macAddress: request.fromNodeId } });
  if (!peer?.ipAddress) throw new Error("Peer address is unavailable");

  const requestPayload = await readConnectionRequestPayload(db as any, requestId);
  const securityStatus = normalizeSecurityStatus(requestPayload?.securityStatus);
  const peerStatus =
    action === "ACCEPTED" ? "TRUSTED" :
    action === "BLOCKED" ? "BLOCKED" :
    action === "DECLINED" ? "DECLINED" : "UNKNOWN";
  const existingSession = action === "ACCEPTED"
    ? await db.peerSession.findFirst({ where: { peerNodeId: request.fromNodeId } })
    : null;

  await db.connectionRequest.update({
    where: { requestId },
    data: { status: action, respondedAt: new Date() },
  });
  await db.meshPeer.upsert({
    where: { macAddress: request.fromNodeId },
    update: {
      status: peerStatus,
      lastHandshake: new Date(),
      ipAddress: peer.ipAddress,
    },
    create: {
      macAddress: request.fromNodeId,
      userId: peer.userId || null,
      hostname: peer.hostname || null,
      ipAddress: peer.ipAddress,
      publicName: peer.publicName || null,
      displayName: peer.displayName || peer.publicName || null,
      status: peerStatus,
      lastHandshake: new Date(),
    },
  });
  await db.meshEvent.create({
    data: {
      originNodeId: getLocalNodeId(),
      entityType: "connection_request",
      entityId: requestId,
      operation: `handshake_${action.toLowerCase()}`,
      payloadJson: JSON.stringify({
        peerNodeId: request.fromNodeId,
        action,
        hostAddress: peer.ipAddress,
        securityStatus,
      }),
    },
  });

  if (action === "ACCEPTED") {
    const contact = await ensureAcceptedMeshContact({
      userId: peer.userId,
      username: peer.publicName || peer.displayName,
      macAddress: request.fromNodeId,
      deviceName: peer.hostname,
    });
    const conversation = await ensureDirectConversationForAcceptedPeer(
      profile.id,
      contact.member.id,
      contact.defaultServer.id,
    );
    await db.meshDevice.upsert({
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
    });
    if (existingSession) {
      await db.peerSession.update({
        where: { sessionId: existingSession.sessionId },
        data: {
          state: "CONNECTED",
          lastConnected: new Date(),
          transportIp: peer.ipAddress,
          transportPort: MESH_CONTROL_PORT,
        },
      });
    } else {
      await db.peerSession.create({
        data: {
          peerNodeId: request.fromNodeId,
          state: "CONNECTED",
          lastConnected: new Date(),
          transportIp: peer.ipAddress,
          transportPort: MESH_CONTROL_PORT,
        },
      });
    }
    await db.syncState.upsert({
      where: { peerNodeId: request.fromNodeId },
      update: {},
      create: { peerNodeId: request.fromNodeId },
    });
    await writeTrustedPeer(db as any, {
      macId: request.fromNodeId,
      hostAddress: peer.ipAddress,
      securityStatus,
    });
    await db.meshEvent.create({
      data: {
        originNodeId: getLocalNodeId(),
        entityType: "conversation",
        entityId: conversation.id,
        operation: "trusted_contact_conversation_ready",
        payloadJson: JSON.stringify({
          peerNodeId: request.fromNodeId,
          peerUserId: contact.profile.userId,
          peerUsername: contact.profile.name,
        }),
      },
    });
  } else {
    await logRejectedPeer(db as any, {
      requestId,
      macId: request.fromNodeId,
      hostAddress: peer.ipAddress,
      securityStatus,
      action,
    });
  }

  if (action === "BLOCKED") {
    await db.meshBlocklist.upsert({
      where: { macAddress: request.fromNodeId },
      update: { reason: "blocked_by_local_user" },
      create: { macAddress: request.fromNodeId, reason: "blocked_by_local_user" },
    });
  }

  await sendMeshControl(peer.ipAddress, {
    type: "connection_response",
    requestId,
    fromNodeId: getLocalNodeId(),
    fromUserId: profile.id,
    fromUsername: profile.name,
    fromPublicName: profile.name,
    fromDeviceName: os.hostname(),
    securityStatus,
    status: action,
  });

  return {
    requestId,
    status: action,
    trustedPeer: action === "ACCEPTED"
      ? {
          macId: request.fromNodeId,
          hostAddress: peer.ipAddress,
          securityStatus,
        }
      : null,
  };
}
