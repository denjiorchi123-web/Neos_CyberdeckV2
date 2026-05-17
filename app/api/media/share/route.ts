import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentProfile } from "@/lib/current-profile";
import { log } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { fileId, channelId }
// Creates a channel message that references the stored file.
export async function POST(req: NextRequest) {
  const profile = await currentProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { fileId, channelId } = await req.json();
  if (!fileId || !channelId) {
    return NextResponse.json({ error: "fileId and channelId required" }, { status: 400 });
  }

  const file = await db.fileIndex.findUnique({ where: { id: fileId } });
  if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });

  const member = await db.member.findFirst({
    where: { profileId: profile.id },
    include: { server: { include: { channels: true } } },
  });
  if (!member) return NextResponse.json({ error: "Not a member" }, { status: 403 });

  function resolveType(mime: string) {
    if (mime.startsWith("image/")) return "IMAGE";
    if (mime.startsWith("video/")) return "VIDEO";
    if (mime.startsWith("audio/")) return "AUDIO";
    return "DOCUMENT";
  }

  const message = await db.message.create({
    data: {
      content:      file.name,
      type:         resolveType(file.mimeType),
      fileUrl:      `/api/files/${file.path}`,
      fileName:     file.name,
      fileSize:     file.size,
      mimeType:     file.mimeType,
      thumbnailUrl: `/api/files/thumb_${file.path}`,
      memberId:     member.id,
      channelId,
    },
  });

  log.event("FILE_SHARE", `${file.name} → channel ${channelId} by ${profile.name}`);

  return NextResponse.json({ message });
}

// GET /api/media/share — return channels the current user can share to
export async function GET() {
  const profile = await currentProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const members = await db.member.findMany({
    where: { profileId: profile.id },
    include: {
      server: {
        include: {
          channels: {
            where: { type: "TEXT" },
            select: { id: true, name: true },
          },
        },
        select: { id: true, name: true, channels: true },
      },
    },
  });

  const servers = members.map(m => ({
    id:       m.server.id,
    name:     m.server.name,
    channels: m.server.channels,
  }));

  return NextResponse.json({ servers });
}
