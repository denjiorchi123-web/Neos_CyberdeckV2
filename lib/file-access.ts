import "server-only";

import { db } from "@/lib/db";

export async function profileServerIds(profileId: string) {
  const memberships = await db.member.findMany({
    where: {
      profileId,
      OR: [
        { server: { profileId } },
        { server: { inviteCode: { not: "cyberdeck-default" } } },
      ],
    },
    select: { serverId: true },
  });
  return memberships.map((membership) => membership.serverId);
}

export async function findAccessibleFile(profileId: string, fileId: string) {
  const serverIds = await profileServerIds(profileId);
  return db.fileIndex.findFirst({
    where: {
      id: fileId,
      OR: [
        { uploaderId: profileId },
        { serverId: { in: serverIds } },
      ],
    },
  });
}

export async function canAccessStoredFile(profileId: string, requestedPath: string) {
  const indexedPath = requestedPath.startsWith("thumb_")
    ? requestedPath.slice("thumb_".length)
    : requestedPath;
  const serverIds = await profileServerIds(profileId);
  const file = await db.fileIndex.findFirst({
    where: {
      path: indexedPath,
      OR: [
        { uploaderId: profileId },
        { serverId: { in: serverIds } },
      ],
    },
    select: { id: true },
  });
  if (file) return true;

  // Older attachments may predate FileIndex. Keep them available only when
  // they are referenced by a chat this profile is actually allowed to read.
  const fileUrl = `/api/files/${indexedPath}`;
  const thumbnailUrl = `/api/files/thumb_${indexedPath}`;
  const [directMessage, channelMessage, broadcastMessage] = await Promise.all([
    db.directMessage.findFirst({
      where: {
        OR: [{ fileUrl }, { thumbnailUrl }],
        conversation: {
          OR: [
            { memberOne: { profileId } },
            { memberTwo: { profileId } },
          ],
        },
      },
      select: { id: true },
    }),
    db.message.findFirst({
      where: {
        OR: [{ fileUrl }, { thumbnailUrl }],
        channel: { server: { members: { some: { profileId } } } },
      },
      select: { id: true },
    }),
    db.broadcastMessage.findFirst({
      where: {
        fileUrl,
        channel: {
          OR: [
            { profileId },
            { followers: { some: { profileId } } },
          ],
        },
      },
      select: { id: true },
    }),
  ]);

  return Boolean(directMessage || channelMessage || broadcastMessage);
}
