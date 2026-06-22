import { NextRequest, NextResponse } from "next/server";
import { renameSync, existsSync } from "fs";
import { currentProfile } from "@/lib/current-profile";
import { resolveFileManagerPath } from "@/lib/file-manager-path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { from, to } — rename or move
export async function POST(req: NextRequest) {
  const profile = await currentProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { from: string; to: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const from = resolveFileManagerPath(body.from ?? null);
  const to   = resolveFileManagerPath(body.to   ?? null);
  if (!from || !to) return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  if (!existsSync(from)) return NextResponse.json({ error: "Source not found" }, { status: 404 });
  if (existsSync(to))    return NextResponse.json({ error: "Destination already exists" }, { status: 409 });

  try {
    try {
      renameSync(from, to);
    } catch (err: any) {
      if (err.code === "EXDEV") {
        const fs = await import("fs");
        const path = await import("path");
        const stat = fs.statSync(from);

        if (stat.isDirectory()) {
          const copyDirSync = (srcDir: string, destDir: string) => {
            fs.mkdirSync(destDir, { recursive: true });
            const entries = fs.readdirSync(srcDir, { withFileTypes: true });
            for (const entry of entries) {
              const srcPath = path.join(srcDir, entry.name);
              const destPath = path.join(destDir, entry.name);
              if (entry.isDirectory()) {
                copyDirSync(srcPath, destPath);
              } else {
                fs.copyFileSync(srcPath, destPath);
              }
            }
          };

          const rmDirSync = (dirPath: string) => {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            for (const entry of entries) {
              const fullPath = path.join(dirPath, entry.name);
              if (entry.isDirectory()) {
                rmDirSync(fullPath);
              } else {
                fs.unlinkSync(fullPath);
              }
            }
            fs.rmdirSync(dirPath);
          };

          copyDirSync(from, to);
          rmDirSync(from);
        } else {
          fs.copyFileSync(from, to);
          fs.unlinkSync(from);
        }
      } else {
        throw err;
      }
    }
    return NextResponse.json({ ok: true, to });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
