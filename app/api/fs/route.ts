import { NextRequest, NextResponse } from "next/server";
import { readdirSync, statSync, rmSync } from "fs";
import { join } from "path";
import { currentProfile } from "@/lib/current-profile";
import { resolveFileManagerPath } from "@/lib/file-manager-path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mimeGroup(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg","jpeg","png","gif","webp","bmp","svg"].includes(ext)) return "image";
  if (["mp4","mkv","avi","mov","webm"].includes(ext))              return "video";
  if (["mp3","wav","m4a","flac","ogg","aac"].includes(ext))        return "audio";
  if (["pdf"].includes(ext))                                        return "pdf";
  if (["zip","tar","gz","bz2","xz","7z","rar"].includes(ext))      return "archive";
  if (["txt","md","log","json","yaml","yml","toml","ini",
       "sh","py","js","ts","tsx","jsx","css","html",
       "conf","cfg","env","xml","csv"].includes(ext))               return "text";
  return "file";
}

function humanSize(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576)    return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024)       return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

// GET — list directory
export async function GET(req: NextRequest) {
  const profile = await currentProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const raw  = req.nextUrl.searchParams.get("path");
  const path = resolveFileManagerPath(raw);
  if (!path) return NextResponse.json({ error: "Invalid path" }, { status: 400 });

  try {
    const stat = statSync(path);
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: "Not a directory" }, { status: 400 });
    }

    const entries = readdirSync(path, { withFileTypes: true });
    const items = entries
      .filter(e => !e.name.startsWith("."))
      .map(e => {
        const full = join(path, e.name);
        let size = 0, modified = 0;
        try { const s = statSync(full); size = s.size; modified = s.mtimeMs; } catch {}
        return {
          name:      e.name,
          path:      full,
          isDir:     e.isDirectory(),
          isSymlink: e.isSymbolicLink(),
          size,
          sizeHuman: humanSize(size),
          modified,
          mimeGroup: e.isDirectory() ? "folder" : mimeGroup(e.name),
        };
      })
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    // Build breadcrumb
    const pathSep  = process.platform === "win32" ? "\\" : "/";
    const segments = path.split(/[/\\]/).filter(Boolean);
    const crumbs   = segments.map((seg, i) => ({
      name: seg,
      path: (process.platform === "win32" ? "" : "/") +
            segments.slice(0, i + 1).join(pathSep) +
            (process.platform === "win32" && i === 0 ? pathSep : ""),
    }));

    return NextResponse.json({ path, crumbs, items });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.code === "ENOENT" ? 404 : 500 });
  }
}

// DELETE — remove file or directory (recursive)
export async function DELETE(req: NextRequest) {
  const profile = await currentProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const raw  = req.nextUrl.searchParams.get("path");
  const path = resolveFileManagerPath(raw);
  if (!path) return NextResponse.json({ error: "Invalid path" }, { status: 400 });

  // Guard: never delete filesystem roots
  const parts = path.replace(/[/\\]+$/, "").split(/[/\\]/).filter(Boolean);
  if (parts.length < 2) {
    return NextResponse.json({ error: "Cannot delete a root directory" }, { status: 403 });
  }

  try {
    rmSync(path, { recursive: true, force: true });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
