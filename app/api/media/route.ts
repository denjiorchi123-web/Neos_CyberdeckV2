import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentProfile } from "@/lib/current-profile";
import { ensureDirs } from "@/lib/media-dirs";
import { profileServerIds } from "@/lib/file-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CATEGORIES: Record<string, string[]> = {
  photos:    ["image/"],
  videos:    ["video/"],
  audio:     ["audio/"],
  documents: [],           // everything else
};

export async function GET(req: NextRequest) {
  const profile = await currentProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  ensureDirs();

  const category = req.nextUrl.searchParams.get("category") ?? "all";

  const serverIds = await profileServerIds(profile.id);
  const allFiles = await db.fileIndex.findMany({
    where: {
      OR: [
        { uploaderId: profile.id },
        { serverId: { in: serverIds } },
      ],
    },
    orderBy: { createdAt: "desc" },
  });

  const filtered = allFiles.filter(f => {
    if (category === "all") return true;
    const prefixes = CATEGORIES[category];
    if (!prefixes) return true;
    if (prefixes.length === 0) {
      // documents = anything not image/video/audio
      return !f.mimeType.startsWith("image/") &&
             !f.mimeType.startsWith("video/") &&
             !f.mimeType.startsWith("audio/");
    }
    return prefixes.some(p => f.mimeType.startsWith(p));
  });

  const files = filtered.map(f => ({
    id:           f.id,
    name:         f.name,
    filename:     f.path,
    url:          `/api/files/${f.path}`,
    thumbnailUrl: f.path.startsWith("thumb_") ? null : `/api/files/thumb_${f.path}`,
    size:         f.size,
    mimeType:     f.mimeType,
    uploaderId:   f.uploaderId,
    source:       f.serverId,
    createdAt:    f.createdAt,
  }));

  return NextResponse.json({ files });
}
