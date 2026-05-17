import { NextResponse } from "next/server";
import os from "os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const uptimeSec  = Math.floor(os.uptime());
  const totalMem   = os.totalmem();
  const freeMem    = os.freemem();
  const usedMem    = totalMem - freeMem;
  const cpus       = os.cpus();
  const loadAvg    = os.loadavg(); // [1m, 5m, 15m]

  // CPU usage: average idle across all cores from the first sample
  let cpuPct = 0;
  if (cpus.length > 0) {
    const times = cpus[0].times;
    const total  = Object.values(times).reduce((a, b) => a + b, 0);
    cpuPct = total > 0 ? Math.round((1 - times.idle / total) * 100) : 0;
  }

  return NextResponse.json({
    uptimeSec,
    totalMem,
    usedMem,
    freeMem,
    cpuPct,
    loadAvg,
    platform: os.platform(),
    hostname: os.hostname(),
    arch:     os.arch(),
  });
}
