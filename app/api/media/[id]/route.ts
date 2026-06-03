import { NextRequest, NextResponse } from "next/server";
import { unlink } from "fs/promises";
import { existsSync } from "fs";
import { db } from "@/lib/db";
import { currentProfile } from "@/lib/current-profile";
import { ensureDirs, resolveStoredFilePath } from "@/lib/media-dirs";
import { log } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const profile = await currentProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const file = await db.fileIndex.findUnique({ where: { id: params.id } });
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  ensureDirs();
  // Delete physical file + thumbnail
  const paths = [
    resolveStoredFilePath(file.path),
    resolveStoredFilePath(`thumb_${file.path}`),
  ];
  for (const p of paths) {
    if (existsSync(p)) await unlink(p).catch(() => undefined);
  }

  await db.fileIndex.delete({ where: { id: params.id } });

  log.event("FILE_DELETE", `${file.name} (${file.path}) by ${profile.name}`);

  return NextResponse.json({ success: true });
}
