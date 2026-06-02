import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import { currentProfile } from "@/lib/current-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IP_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const LINUX_ALLOWED = ["bat0", "eth0", "usb0", "eth1", "eth2", "enp1s0", "enp2s0", "enp3s0", "wlan0"];

function cidrToMask(prefix: number): string {
  const mask = ~(0xffffffff >>> prefix) >>> 0;
  return [(mask >>> 24) & 0xff, (mask >>> 16) & 0xff, (mask >>> 8) & 0xff, mask & 0xff].join(".");
}

// ── Windows ───────────────────────────────────────────────────────────────────

function isElevated(): boolean {
  try {
    // "net session" exits 0 only when running as Administrator
    execSync("net session", { timeout: 3000, windowsHide: true, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function requireElevated() {
  if (!isElevated()) {
    throw new Error(
      "Network changes require Administrator privileges on Windows. " +
      "Re-launch the terminal as Administrator and restart the server."
    );
  }
}

function netshError(e: any): never {
  const stderr: string = e.stderr?.toString() ?? "";
  const msg: string    = e.message ?? String(e);
  if (/access.denied|elevation|administrator|privilege/i.test(stderr + msg)) {
    throw new Error(
      "Access denied — run the server as Administrator to change network settings on Windows."
    );
  }
  // Surface the actual netsh error line if present
  const detail = stderr.trim().split("\n").find((l: string) => l.trim()) ?? msg;
  throw new Error(`netsh: ${detail}`);
}

function applyWindowsDhcp(iface: string) {
  requireElevated();
  const name = iface.replace(/"/g, '""');
  try {
    execSync(`netsh interface ip set address "${name}" dhcp`,
      { timeout: 15000, windowsHide: true, stdio: "pipe" });
  } catch (e) { netshError(e); }
  try {
    execSync(`netsh interface ip set dns "${name}" dhcp`,
      { timeout: 8000, windowsHide: true, stdio: "pipe" });
  } catch {}
}

function applyWindowsStatic(iface: string, ip: string, prefix: number, gateway?: string) {
  requireElevated();
  const name = iface.replace(/"/g, '""');
  const mask = cidrToMask(prefix);
  try {
    if (gateway) {
      execSync(`netsh interface ip set address "${name}" static ${ip} ${mask} ${gateway} 1`,
        { timeout: 15000, windowsHide: true, stdio: "pipe" });
    } else {
      execSync(`netsh interface ip set address "${name}" static ${ip} ${mask}`,
        { timeout: 15000, windowsHide: true, stdio: "pipe" });
      try {
        execSync(`netsh interface ip delete route 0.0.0.0/0 "${name}"`,
          { timeout: 5000, windowsHide: true, stdio: "pipe" });
      } catch {}
    }
  } catch (e) { netshError(e); }
}

// ── Linux ─────────────────────────────────────────────────────────────────────

function applyLinux(iface: string, mode: "static" | "dhcp", ip?: string, prefix?: number, gateway?: string) {
  if (!LINUX_ALLOWED.includes(iface)) throw new Error(`Interface "${iface}" is not in the allowed list.`);
  const args = mode === "dhcp"
    ? `${iface} dhcp`
    : `${iface} ${ip} ${prefix}${gateway ? ` ${gateway}` : ""}`;
  execSync(`sudo /usr/local/bin/cyberdeck-netconfig.sh ${args}`, { timeout: 15000 });
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const profile = await currentProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { iface: string; mode: "static" | "dhcp"; ip?: string; prefix?: number; gateway?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { iface, mode, ip, prefix, gateway } = body;

  if (!iface?.trim())
    return NextResponse.json({ error: "Interface name is required." }, { status: 400 });
  if (mode !== "static" && mode !== "dhcp")
    return NextResponse.json({ error: "mode must be 'static' or 'dhcp'." }, { status: 400 });

  if (mode === "static") {
    if (!ip || !IP_RE.test(ip))
      return NextResponse.json({ error: "Valid IP address is required for static mode." }, { status: 400 });
    if (!prefix || !Number.isInteger(prefix) || prefix < 1 || prefix > 32)
      return NextResponse.json({ error: "Prefix length must be 1–32." }, { status: 400 });
    if (gateway && !IP_RE.test(gateway))
      return NextResponse.json({ error: "Invalid gateway address." }, { status: 400 });
  }

  try {
    if (process.platform === "win32") {
      if (mode === "dhcp") applyWindowsDhcp(iface);
      else                 applyWindowsStatic(iface, ip!, prefix!, gateway);
    } else {
      applyLinux(iface, mode, ip, prefix, gateway);
    }
    return NextResponse.json({ ok: true, iface, mode, ip, prefix, gateway });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Failed to apply." }, { status: 500 });
  }
}
