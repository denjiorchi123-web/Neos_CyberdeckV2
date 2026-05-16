import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join, extname, basename } from "path";
import { currentProfile } from "@/lib/current-profile";

const MIME: Record<string, string> = {
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png":  "image/png",
  ".gif":  "image/gif",
  ".webp": "image/webp",
  ".mp4":  "video/mp4",
  ".webm": "video/webm",
  ".ogg":  "audio/ogg",
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

  const filePath = join(process.cwd(), "private", "uploads", filename);

  try {
    const data = await readFile(filePath);
    const ext  = extname(filename).toLowerCase();
    const mime = MIME[ext] ?? "application/octet-stream";

    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type":        mime,
        "Content-Length":      String(data.byteLength),
        "Content-Disposition": `inline; filename="${filename}"`,
        // Long cache on the client side — files are immutable (UUID names)
        "Cache-Control":       "private, max-age=86400",
      }
    });
  } catch {
    return new NextResponse("Not Found", { status: 404 });
  }
}
