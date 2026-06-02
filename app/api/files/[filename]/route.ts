import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join, extname, basename } from "path";
import { currentProfile } from "@/lib/current-profile";

export const dynamic = "force-dynamic";

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
    const fileSize = data.byteLength;
    const ext  = extname(filename).toLowerCase();
    const mime = MIME[ext] ?? "application/octet-stream";

    const range = req.headers.get("range");
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      
      const chunk = data.subarray(start, end + 1);
      
      return new NextResponse(chunk, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunksize),
          "Content-Type": mime,
          "Cache-Control": "private, max-age=86400",
        }
      });
    }

    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type":        mime,
        "Content-Length":      String(fileSize),
        "Accept-Ranges":       "bytes",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control":       "private, max-age=86400",
      }
    });
  } catch {
    return new NextResponse("Not Found", { status: 404 });
  }
}
