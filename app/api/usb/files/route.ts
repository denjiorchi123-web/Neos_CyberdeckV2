import { NextRequest, NextResponse } from "next/server";
import { readdirSync, statSync } from "fs";
import { join, normalize, basename } from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MEDIA_ROOT = "/media";

function safePath(raw: string | null): string | null {
  if (!raw) return null;
  const abs = normalize(raw);
  if (abs.includes("..")) return null;
  // Windows: allow any drive-letter path (D:\, E:\folder, etc.)
  if (process.platform === "win32") {
    if (/^[A-Za-z]:\\/.test(abs)) return abs;
    return null;
  }
  // Linux: must stay inside /media/
  if (!abs.startsWith(MEDIA_ROOT + "/")) return null;
  return abs;
}

function humanSize(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576)    return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024)       return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function mimeGroup(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg","jpeg","png","gif","webp","bmp","svg"].includes(ext)) return "image";
  if (["mp4","mkv","avi","mov","webm"].includes(ext))              return "video";
  if (["mp3","wav","m4a","flac","ogg","aac"].includes(ext))        return "audio";
  if (["pdf"].includes(ext))                                        return "pdf";
  if (["zip","tar","gz","bz2","xz","7z","rar"].includes(ext))      return "archive";
  if (["txt","md","log","csv","json","xml","yaml","yml"].includes(ext)) return "text";
  return "file";
}

export async function GET(req: NextRequest) {
  const raw  = req.nextUrl.searchParams.get("path");
  const path = safePath(raw);

  if (!path) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    const entries = readdirSync(path, { withFileTypes: true });
    const items = entries
      .filter(e => !e.name.startsWith("."))     // hide dot files
      .map(e => {
        const full = join(path, e.name);
        let size = 0;
        let modified = 0;
        try {
          const st = statSync(full);
          size     = st.size;
          modified = st.mtimeMs;
        } catch { /* broken symlink etc */ }

        return {
          name:        e.name,
          path:        full,
          isDir:       e.isDirectory(),
          size,
          sizeHuman:   humanSize(size),
          modified,
          mimeGroup:   e.isDirectory() ? "folder" : mimeGroup(e.name),
        };
      })
      .sort((a, b) => {
        // Folders first, then alphabetical
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    // Build breadcrumb — cross-platform: split on either / or \
    const sep      = process.platform === "win32" ? "\\" : "/";
    const segments = path.split(/[/\\]/).filter(Boolean);
    const crumbs   = segments.map((seg, i) => ({
      name: seg,
      path: segments.slice(0, i + 1).join(sep) + (i === 0 && process.platform === "win32" ? sep : ""),
    }));

    return NextResponse.json({ path, crumbs, items });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
