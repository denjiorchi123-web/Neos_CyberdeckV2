import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { extname, basename } from "path";
import { Readable } from "stream";
import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";
import { ensureDirs, resolveStoredFilePath } from "@/lib/media-dirs";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png":  "image/png",
  ".gif":  "image/gif",
  ".webp": "image/webp",
  ".mp4":  "video/mp4",
  ".m4v":  "video/mp4",
  ".mov":  "video/quicktime",
  ".webm": "video/webm",
  ".mkv":  "video/x-matroska",
  ".avi":  "video/x-msvideo",
  ".ogg":  "audio/ogg",
  ".ogv":  "video/ogg",
  ".mp3":  "audio/mpeg",
  ".wav":  "audio/wav",
  ".m4a":  "audio/mp4",
  ".pdf":  "application/pdf",
  ".zip":  "application/zip",
  ".txt":  "text/plain; charset=utf-8",
  ".bin":  "application/octet-stream",
};

export async function GET(
  req: NextRequest,
  { params }: { params: { filename: string } }
) {
  // Require authentication — files are in private/, not public/
  const profile = await currentProfile();
  if (!profile) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // Sanitize: strip directory traversal
  const filename = basename(params.filename);
  if (!filename || filename.includes("..")) {
    return new NextResponse("Bad Request", { status: 400 });
  }

  ensureDirs();
  const filePath = resolveStoredFilePath(filename);

  try {
    const fileSize = (await stat(filePath)).size;
    const ext  = extname(filename).toLowerCase();
    const indexed = await db.fileIndex.findFirst({
      where: { path: filename },
      select: { mimeType: true },
    }).catch(() => null);
    const mime = indexed?.mimeType || MIME[ext] || "application/octet-stream";

    const range = req.headers.get("range");
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= fileSize) {
        return new NextResponse("Range Not Satisfiable", {
          status: 416,
          headers: { "Content-Range": `bytes */${fileSize}` },
        });
      }
      const safeEnd = Math.min(end, fileSize - 1);
      const chunksize = (safeEnd - start) + 1;
      const stream = Readable.toWeb(createReadStream(filePath, { start, end: safeEnd })) as ReadableStream;
      
      return new NextResponse(stream, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${safeEnd}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunksize),
          "Content-Type": mime,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, max-age=86400",
        }
      });
    }

    const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
    return new NextResponse(stream, {
      status: 200,
      headers: {
        "Content-Type":        mime,
        "X-Content-Type-Options": "nosniff",
        "Content-Length":      String(fileSize),
        "Accept-Ranges":       "bytes",
        "Content-Disposition": `${req.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="${filename}"`,
        "Cache-Control":       "private, max-age=86400",
      }
    });
  } catch {
    return new NextResponse("Not Found", { status: 404 });
  }
}
