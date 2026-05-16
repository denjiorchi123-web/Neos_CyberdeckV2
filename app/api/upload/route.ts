import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";
import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";

// 100 MB — generous for LAN transfers; no cloud egress cost
const MAX_SIZE = 100 * 1024 * 1024;

// MIME → canonical type label used by chat-item.tsx
function resolveType(mime: string): string {
  if (mime.startsWith("image/"))  return "IMAGE";
  if (mime.startsWith("video/"))  return "VIDEO";
  if (mime.startsWith("audio/"))  return "AUDIO";
  return "DOCUMENT";
}

export async function POST(req: NextRequest) {
  try {
    const profile = await currentProfile();
    if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const formData  = await req.formData();
    const file      = formData.get("file") as File | null;
    const serverId  = (formData.get("serverId") as string | null) ?? "dm";
    const mediaKey  = (formData.get("mediaKey") as string | null) ?? undefined;

    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
    if (file.size > MAX_SIZE)
      return NextResponse.json({ error: `File too large (max ${MAX_SIZE / 1024 / 1024} MB)` }, { status: 413 });

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const ext      = (file.name.split(".").pop() || "bin").toLowerCase();
    const safeName = `${uuidv4()}.${ext}`;
    const mime     = file.type || "application/octet-stream";
    const fileType = resolveType(mime);

    // Store in private/ directory — served only through the authenticated /api/files/[filename]
    // endpoint so nobody can hot-link directly to the raw path.
    const uploadDir  = join(process.cwd(), "private", "uploads");
    await mkdir(uploadDir, { recursive: true });
    await writeFile(join(uploadDir, safeName), buffer);

    // Generate thumbnail for images using sharp (optional — skip if not installed)
    let thumbnailUrl: string | undefined;
    if (fileType === "IMAGE") {
      try {
        // Dynamic import keeps server bundle small; sharp is an optional devDep
        const sharp = (await import("sharp")).default;
        const thumbName = `thumb_${safeName}`;
        await sharp(buffer)
          .resize(320, 320, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 75 })
          .toFile(join(uploadDir, thumbName));
        thumbnailUrl = `/api/files/${thumbName}`;
      } catch {
        // sharp not installed or unsupported input — thumbnails optional
      }
    }

    // Index the file in the DB so admins can audit uploads
    await db.fileIndex.create({
      data: {
        name:       file.name,
        path:       safeName,
        size:       file.size,
        mimeType:   mime,
        uploaderId: profile.id,
        serverId:   serverId,
      }
    });

    return NextResponse.json({
      url:          `/api/files/${safeName}`,
      thumbnailUrl: thumbnailUrl ?? null,
      fileName:     file.name,
      fileSize:     file.size,
      mimeType:     mime,
      type:         fileType,
      mediaKey:     mediaKey ?? null,
    });
  } catch (error) {
    console.error("[UPLOAD_POST]", error);
    return new NextResponse("Upload failed", { status: 500 });
  }
}
