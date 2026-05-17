import { NextRequest, NextResponse } from "next/server";
import { createReadStream, statSync } from "fs";
import { normalize, basename } from "path";
import { Readable } from "stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MEDIA_ROOT = "/media";

function safePath(raw: string | null): string | null {
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

export async function GET(req: NextRequest) {
  const path = safePath(req.nextUrl.searchParams.get("path"));
  if (!path) return NextResponse.json({ error: "Invalid path" }, { status: 400 });

  let size: number;
  try {
    const st = statSync(path);
    if (st.isDirectory()) return NextResponse.json({ error: "Cannot download a directory" }, { status: 400 });
    size = st.size;
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const name   = basename(path);
  const stream = createReadStream(path);
  const web    = Readable.toWeb(stream) as ReadableStream;

  return new NextResponse(web, {
    headers: {
      "Content-Disposition": `attachment; filename="${encodeURIComponent(name)}"`,
      "Content-Length":      String(size),
      "Content-Type":        "application/octet-stream",
      "Cache-Control":       "no-store",
    },
  });
}
