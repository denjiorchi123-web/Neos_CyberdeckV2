import "server-only";

import type { Profile } from "@prisma/client";

import { db } from "@/lib/db";

export const LEGACY_CHAT_SERVER_CODE = "cyberdeck-default";
export const PERSONAL_CHAT_SERVER_PREFIX = "cyberdeck-dm-";

type WorkspaceProfile = Pick<Profile, "id" | "userId" | "name">;

export function personalChatServerCode(profileId: string) {
  return `${PERSONAL_CHAT_SERVER_PREFIX}${profileId}`;
}

export function isPersonalChatServerCode(inviteCode: string) {
  return inviteCode === LEGACY_CHAT_SERVER_CODE ||
    inviteCode.startsWith(PERSONAL_CHAT_SERVER_PREFIX);
}

export async function findProfileChatServer(profileId: string) {
  return db.server.findFirst({
    where: {
      profileId,
      OR: [
        { inviteCode: LEGACY_CHAT_SERVER_CODE },
        { inviteCode: { startsWith: PERSONAL_CHAT_SERVER_PREFIX } },
      ],
    },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Every login profile owns a private DM workspace. Older builds joined every
 * new profile to one global server, exposing that server's contacts and chat
 * history. Creating the private workspace and removing that legacy automatic
 * membership upgrades existing profiles the next time they sign in.
 */
export async function ensureProfileWorkspace(profile: WorkspaceProfile) {
  let server = await findProfileChatServer(profile.id);

  if (!server) {
    server = await db.server.create({
      data: {
        name: `${profile.name}'s Chats`,
        imageUrl: "",
        inviteCode: personalChatServerCode(profile.id),
        profileId: profile.id,
        members: {
          create: {
            profileId: profile.id,
            role: "ADMIN",
          },
        },
      },
    });
  } else {
    const ownMember = await db.member.findFirst({
      where: { profileId: profile.id, serverId: server.id },
      select: { id: true },
    });

    if (!ownMember) {
      await db.member.create({
        data: {
          profileId: profile.id,
          serverId: server.id,
          role: "ADMIN",
        },
      });
    }
  }

  // Remove only the membership that old versions added automatically. The
  // owner of the original server keeps it, and normal groups are untouched.
  if (server.inviteCode !== LEGACY_CHAT_SERVER_CODE) {
    const legacyServer = await db.server.findFirst({
      where: {
        inviteCode: LEGACY_CHAT_SERVER_CODE,
        profileId: { not: profile.id },
      },
      select: { id: true },
    });

    if (legacyServer) {
      const legacyMember = await db.member.findFirst({
        where: {
          profileId: profile.id,
          serverId: legacyServer.id,
          role: "GUEST",
        },
        select: {
          id: true,
          _count: {
            select: {
              messages: true,
              directMessages: true,
              conversationsInitiated: true,
              conversationsReceived: true,
            },
          },
        },
      });

      const count = legacyMember?._count;
      const isUnusedAutomaticMembership = count &&
        count.messages === 0 &&
        count.directMessages === 0 &&
        count.conversationsInitiated === 0 &&
        count.conversationsReceived === 0;

      const isUserCreatedProfile = /^user_[a-f0-9]{20}$/i.test(profile.userId);
      if (legacyMember && (isUserCreatedProfile || isUnusedAutomaticMembership)) {
        await db.member.delete({ where: { id: legacyMember.id } });
      }
    }
  }

  return server;
}
