import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface UsbDrive {
  slot:        string;
  device:      string;
  mountPoint:  string;
  label?:      string;
  fstype?:     string;
  freeBytes?:  number;
  totalBytes?: number;
  mounted:     boolean;
}

// ── Windows detection via PowerShell ─────────────────────────────────────────
// DriveType 2 = Removable (USB pen drives, card readers, etc.)
// Each logical disk = one partition, so multi-partition drives list all of them.

function windowsDrives(): UsbDrive[] {
  try {
    const raw = execSync(
      "powershell -NoProfile -Command \"" +
        "Get-WmiObject Win32_LogicalDisk |" +
        " Where-Object {$_.DriveType -eq 2} |" +
        " Select-Object DeviceID,VolumeName,Size,FreeSpace,FileSystem |" +
        " ConvertTo-Json -Compress\"",
      { timeout: 8000, encoding: "utf8" }
    );
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "null") return [];

    let items = JSON.parse(trimmed);
    if (!Array.isArray(items)) items = [items];

    return items.map((d: Record<string, unknown>, i: number) => {
      const deviceId  = String(d.DeviceID  ?? "");
      const freeSpace = d.FreeSpace != null ? Number(d.FreeSpace) : undefined;
      const size      = d.Size      != null ? Number(d.Size)      : undefined;
      return {
        slot:       `usb${i}`,
        device:     deviceId,
        mountPoint: deviceId.endsWith("\\") ? deviceId : deviceId + "\\",
        label:      d.VolumeName ? String(d.VolumeName) : undefined,
        fstype:     d.FileSystem ? String(d.FileSystem) : undefined,
        freeBytes:  isNaN(freeSpace as number) ? undefined : freeSpace,
        totalBytes: isNaN(size      as number) ? undefined : size,
        mounted:    true,
      };
    });
  } catch {
    return [];
  }
}

// ── Linux: lsblk JSON ────────────────────────────────────────────────────────
// flattenLsblk recurses into children so ALL partitions of a multi-partition
// drive are returned, not just the first one.
// Accept a partition if:
//   1. rm=1 or hotplug=1  (classic removable flag)
//   2. already mounted under /media/  (udev automounted it → definitely USB)

interface LsblkDevice {
  name:        string;
  type:        string;
  rm?:         boolean | string | number;
  hotplug?:    boolean | string | number;
  mountpoint?: string | null;
  fstype?:     string | null;
  label?:      string | null;
  size?:       string | number;
  children?:   LsblkDevice[];
}

function isTruthy(v: unknown): boolean {
  return v === true || v === "1" || v === 1;
}

function flattenLsblk(devices: LsblkDevice[]): LsblkDevice[] {
  const out: LsblkDevice[] = [];
  for (const d of devices) {
    if (d.children?.length) out.push(...flattenLsblk(d.children));
    else out.push(d);
  }
  return out;
}

function driveStats(mp: string): { free?: number; total?: number } {
  try {
    const { statfsSync } = require("fs") as typeof import("fs");
    if (typeof statfsSync === "function") {
      const s = statfsSync(mp);
      return { total: s.blocks * s.bsize, free: s.bfree * s.bsize };
    }
  } catch { /* Node < 18 or Windows */ }
  return {};
}

function lsblkDrives(): UsbDrive[] {
  try {
    const raw = execSync(
      "lsblk -J -b -o NAME,TYPE,RM,HOTPLUG,MOUNTPOINT,FSTYPE,LABEL,SIZE 2>/dev/null",
      { timeout: 4000, encoding: "utf8", shell: "/bin/sh" }
    );
    const json       = JSON.parse(raw) as { blockdevices: LsblkDevice[] };
    const partitions = flattenLsblk(json.blockdevices ?? []);

    const drives: UsbDrive[] = [];
    let slot = 0;

    for (const p of partitions) {
      if (p.type !== "part" && p.type !== "disk") continue;

      const mp      = p.mountpoint ?? null;
      const mounted = !!mp && mp !== "";
      const fstype  = p.fstype ?? "";

      // Skip system pseudo-filesystems
      if (["swap", "squashfs", "tmpfs", "devtmpfs"].includes(fstype)) continue;
      if (mounted && (mp!.startsWith("/sys") || mp!.startsWith("/proc") || mp === "/")) continue;

      const isRemovable = isTruthy(p.rm) || isTruthy(p.hotplug);
      const isMediaMount = mounted && mp!.startsWith("/media/");

      if (!isRemovable && !isMediaMount) continue;

      const stats = mounted ? driveStats(mp!) : {};

      drives.push({
        slot:       `usb${slot++}`,
        device:     `/dev/${p.name}`,
        mountPoint: mp ?? "",
        label:      p.label ?? undefined,
        fstype:     fstype || undefined,
        freeBytes:  stats.free,
        totalBytes: stats.total,
        mounted,
      });
    }
    return drives;
  } catch {
    return [];
  }
}

// ── Linux fallback: /proc/mounts ─────────────────────────────────────────────
// Catches everything mounted under /media/ even if lsblk is unavailable.

function procMountsDrives(): UsbDrive[] {
  const drives: UsbDrive[] = [];
  if (!existsSync("/proc/mounts")) return drives;

  const lines = readFileSync("/proc/mounts", "utf8").split("\n").filter(Boolean);
  let slot = 0;

  for (const line of lines) {
    const [device, mp, fstype] = line.split(" ");
    if (!device?.startsWith("/dev/")) continue;
    if (!mp?.startsWith("/media/")) continue;

    const stats = driveStats(mp);
    drives.push({
      slot:       `usb${slot++}`,
      device,
      mountPoint: mp,
      fstype,
      freeBytes:  stats.free,
      totalBytes: stats.total,
      mounted:    true,
    });
  }
  return drives;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET() {
  let drives: UsbDrive[];

  if (process.platform === "win32") {
    drives = windowsDrives();
  } else {
    drives = lsblkDrives();
    if (drives.length === 0) drives = procMountsDrives();
    // Only return drives that udev has already mounted
    drives = drives.filter(d => d.mounted);
  }

  return NextResponse.json({ drives });
}
