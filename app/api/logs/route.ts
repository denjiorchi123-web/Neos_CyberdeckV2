import { NextRequest, NextResponse } from "next/server";
import { existsSync, statSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import { execSync } from "child_process";
import { ensureDirs } from "@/lib/media-dirs";
import { currentProfile } from "@/lib/current-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOG_FILE = join(process.cwd(), "private", "logs", "app.log");
const MAX_LINES = 500;

function tail(text: string, n: number): string[] {
  const lines = text.split("\n").filter(Boolean);
  return lines.slice(-n);
}

function systemLogs(): string[] {
  try {
    const out = execSync(
      "journalctl -u cyberdeck-web -u cyberdeck-kiosk --no-pager -n 100 --output=short-iso 2>/dev/null",
      { timeout: 3000, encoding: "utf8" }
    );
    return out.split("\n").filter(Boolean).map(l => `[SYSTEM] ${l}`);
  } catch {
    return [];
  }
}

function diskInfo(): string[] {
  try {
    const out = execSync("df -h /opt/cyberdeck /media 2>/dev/null || df -h /", {
      timeout: 2000, encoding: "utf8",
    });
    return out.split("\n").filter(Boolean).map(l => `[DISK]   ${l}`);
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const profile = await currentProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  ensureDirs();

  const source = req.nextUrl.searchParams.get("source") ?? "app";
  const lines: string[] = [];

  if (source === "app" || source === "all") {
    if (existsSync(LOG_FILE)) {
      const raw = await readFile(LOG_FILE, "utf8");
      lines.push(...tail(raw, MAX_LINES));
    } else {
      lines.push(`${new Date().toISOString()} [INFO] App log file not yet created — activity will appear here once actions are taken.`);
    }
  }

  if (source === "system" || source === "all") {
    lines.push(...systemLogs());
  }

  if (source === "disk") {
    lines.push(...diskInfo());
  }

  // Parse lines into structured entries
  const entries = lines.map(line => {
    const m = line.match(/^(\S+)\s+\[(\w+)\]\s+(.*)$/);
    return m
      ? { ts: m[1], level: m[2], message: m[3], raw: line }
      : { ts: "",   level: "INFO", message: line, raw: line };
  });

  // Log file stats
  let logSize = 0;
  try { logSize = existsSync(LOG_FILE) ? statSync(LOG_FILE).size : 0; } catch { /* */ }

  return NextResponse.json({ entries, logSize });
}

// DELETE — clear the app log
export async function DELETE() {
  try {
    const profile = await currentProfile();
    if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { writeFileSync } = await import("fs");
    writeFileSync(LOG_FILE, "", "utf8");
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
