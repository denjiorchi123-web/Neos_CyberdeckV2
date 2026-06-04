import "server-only";

import { db } from "@/lib/db";

type MeshContactInput = {
  userId?: string | null;
  username?: string | null;
  macAddress: string;
  deviceName?: string | null;
};

function cleanName(username?: string | null) {
  const name = username?.trim();
  if (!name) throw new Error("Cannot create a contact without a verified username");
  return name.slice(0, 80);
}

function contactUserId(userId: string | null | undefined, macAddress: string) {
  const trimmed = userId?.trim();
  return trimmed || `mesh_${macAddress.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

function contactEmail(userId: string) {
  return `${userId.replace(/[^A-Za-z0-9._-]/g, "_").toLowerCase()}@mesh.local`;
}

export async function ensureAcceptedMeshContact(input: MeshContactInput) {
  const username = cleanName(input.username);
  const userId = contactUserId(input.userId, input.macAddress);

  const defaultServer = await db.server.findFirst({
    where: { inviteCode: "cyberdeck-default" },
  });
  if (!defaultServer) throw new Error("Default chat server is missing");

  let profile = await db.profile.findUnique({ where: { userId } });
  if (!profile) {
    profile = await db.profile.create({
      data: {
        userId,
        name: username,
        imageUrl: "",
        email: contactEmail(userId),
        password: "",
        isOnline: new Date(),
      },
    });
  } else {
    profile = await db.profile.update({
      where: { id: profile.id },
      data: {
        name: username,
        isOnline: new Date(),
        lastSeen: new Date(),
      },
    });
  }

  let member = await db.member.findFirst({
    where: {
      profileId: profile.id,
      serverId: defaultServer.id,
    },
  });
  if (!member) {
    member = await db.member.create({
      data: {
      profileId: profile.id,
      serverId: defaultServer.id,
      role: "GUEST",
    },
    });
  }

  await db.meshPeer.update({
    where: { macAddress: input.macAddress },
    data: {
      userId,
      publicName: username,
      displayName: username,
      hostname: input.deviceName || undefined,
      status: "TRUSTED",
      lastHandshake: new Date(),
    },
  }).catch(() => null);

  return { profile, member, defaultServer };
}

export async function ensureDirectConversationForAcceptedPeer(
  localProfileId: string,
  remoteMemberId: string,
  serverId: string,
) {
  const localMember = await db.member.findFirst({
    where: { profileId: localProfileId, serverId },
  });
  if (!localMember) throw new Error("Local profile is not joined to the default chat server");

  const existing = await db.conversation.findFirst({
    where: {
      OR: [
        { memberOneId: localMember.id, memberTwoId: remoteMemberId },
        { memberOneId: remoteMemberId, memberTwoId: localMember.id },
      ],
    },
  });
  if (existing) return existing;

  return db.conversation.create({
    data: {
      memberOneId: localMember.id,
      memberTwoId: remoteMemberId,
    },
  });
}
