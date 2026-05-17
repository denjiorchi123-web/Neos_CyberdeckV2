import { NextRequest, NextResponse } from "next/server";
import { createReadStream, createWriteStream, statSync, mkdirSync } from "fs";
import { normalize, basename, extname, join } from "path";
import { pipeline } from "stream/promises";
import { v4 as uuidv4 } from "uuid";
import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";
import { log } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MEDIA_ROOT  = "/media";
const UPLOAD_DIR  = join(process.cwd(), "private", "uploads");

function safeSrc(raw: string | null): string | null {
  if (!raw) return null;
  const abs = normalize(raw);
  if (abs.includes("..")) return null;
  if (process.platform === "win32") {
    if (/^[A-Za-z]:\\/.test(abs)) return abs;
    return null;
  }
  if (!abs.startsWith(MEDIA_ROOT + "/")) return null;
  return abs;
}

function mimeFromExt(ext: string): string {
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    gif: "image/gif",  webp: "image/webp", bmp: "image/bmp",
    mp4: "video/mp4",  mkv: "video/x-matroska", webm: "video/webm",
    mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4",
    pdf: "application/pdf",
    txt: "text/plain", md: "text/markdown",
    zip: "application/zip",
  };
  return map[ext.toLowerCase()] ?? "application/octet-stream";
}

export async function POST(req: NextRequest) {
  const profile = await currentProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { srcPath } = await req.json();
  const src = safeSrc(srcPath);
  if (!src) return NextResponse.json({ error: "Invalid source path" }, { status: 400 });

  let fileSize: number;
  try {
    const st = statSync(src);
    if (st.isDirectory()) return NextResponse.json({ error: "Cannot copy a directory" }, { status: 400 });
    fileSize = st.size;
  } catch {
    return NextResponse.json({ error: "Source file not found" }, { status: 404 });
  }

  mkdirSync(UPLOAD_DIR, { recursive: true });

  const originalName = basename(src);
  const ext          = extname(originalName).slice(1) || "bin";
  const savedName    = `${uuidv4()}.${ext}`;
  const destPath     = join(UPLOAD_DIR, savedName);
  const mimeType     = mimeFromExt(ext);

  await pipeline(createReadStream(src), createWriteStream(destPath));

  try {
    await db.fileIndex.create({
      data: {
        name:       originalName,
        path:       savedName,
        size:       fileSize,
        mimeType,
        uploaderId: profile.id,
        serverId:   "usb-copy",
      },
    });
  } catch { /* non-fatal */ }

  log.event("USB_COPY", `${originalName} (${(fileSize/1024).toFixed(0)} KB) from ${src} by ${profile.name}`);

  return NextResponse.json({
    url:          `/api/files/${savedName}`,
    fileName:     originalName,
    fileSize,
    mimeType,
  });
}
