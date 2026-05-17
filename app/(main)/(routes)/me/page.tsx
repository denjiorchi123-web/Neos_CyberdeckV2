"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  Phone, Video, Clock, ChevronDown, Save, Loader2,
  CheckCircle2, AlertCircle, RefreshCw, Plus, X,
  Cpu, MemoryStick, Wifi, WifiOff, Activity,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useSocket } from "@/components/providers/socket-provider";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProfileStats {
  profile:  { id: string; name: string; imageUrl: string; createdAt: string };
  stats:    { messages: number; dms: number; servers: number; calls: number; missed: number };
  callHistory: any[];
}

interface NetInterface {
  name: string; ip?: string; prefix?: number; gateway?: string; mac?: string;
  up: boolean; loopback: boolean; dhcp: boolean;
}

interface NodeStatus {
  uptimeSec: number; totalMem: number; usedMem: number;
  cpuPct: number; platform: string; hostname: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function cidrToMask(prefix: number): string {
  const mask = ~(0xffffffff >>> prefix) >>> 0;
  return [(mask >>> 24) & 0xff, (mask >>> 16) & 0xff, (mask >>> 8) & 0xff, mask & 0xff].join(".");
}

function maskToCidr(mask: string): number {
  return mask.split(".").reduce((acc, o) => {
    let n = parseInt(o), bits = 0;
    while (n) { bits += n & 1; n >>= 1; }
    return acc + bits;
  }, 0);
}

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return `${d}d ${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

function fmtBytes(b: number): string {
  if (b >= 1073741824) return (b / 1073741824).toFixed(1) + " GB";
  if (b >= 1048576)    return (b / 1048576).toFixed(0) + " MB";
  return (b / 1024).toFixed(0) + " KB";
}

const COMMON_MASKS = [
  { mask: "255.255.255.0",   cidr: 24, label: "/24 — 255.255.255.0 (Class C)" },
  { mask: "255.255.0.0",     cidr: 16, label: "/16 — 255.255.0.0 (Class B)"  },
  { mask: "255.255.255.128", cidr: 25, label: "/25 — 255.255.255.128"         },
  { mask: "255.255.255.192", cidr: 26, label: "/26 — 255.255.255.192"         },
  { mask: "255.255.255.240", cidr: 28, label: "/28 — 255.255.255.240"         },
  { mask: "255.0.0.0",       cidr: 8,  label: "/8  — 255.0.0.0 (Class A)"    },
];

function statusColor(s: string) {
  if (s === "ended")    return "text-zinc-400";
  if (s === "missed")   return "text-rose-400";
  if (s === "rejected") return "text-orange-400";
  if (s === "busy")     return "text-yellow-400";
  return "text-zinc-500";
}

// ── Add-Port Modal ────────────────────────────────────────────────────────────

interface AddPortModalProps {
  ifaces: NetInterface[];
  onClose: () => void;
  onApplied: () => void;
}

function AddPortModal({ ifaces, onClose, onApplied }: AddPortModalProps) {
  const unconfigured = ifaces.filter(i => !i.ip);
  const [selIface, setSelIface] = useState(unconfigured[0]?.name ?? "");
  const [mode,     setMode]     = useState<"static" | "dhcp">("dhcp");
  const [ipVal,    setIpVal]    = useState("10.0.0.1");
  const [maskVal,  setMaskVal]  = useState("255.255.255.0");
  const [gwVal,    setGwVal]    = useState("");
  const [applying, setApplying] = useState(false);
  const [msg,      setMsg]      = useState<{ ok: boolean; text: string } | null>(null);

  const apply = async () => {
    setApplying(true);
    setMsg(null);
    try {
      const body: any = { iface: selIface, mode };
      if (mode === "static") {
        body.ip      = ipVal;
        body.prefix  = maskToCidr(maskVal);
        body.gateway = gwVal || undefined;
      }
      const res = await fetch("/api/network/set-ip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      setMsg({ ok: true, text: mode === "dhcp" ? `${selIface}: DHCP enabled.` : `${selIface}: ${ipVal}/${body.prefix} applied.` });
      setTimeout(() => { onApplied(); onClose(); }, 1500);
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-[420px] bg-[#1a1c1e] border border-zinc-700 rounded-2xl overflow-hidden font-mono shadow-2xl">
        <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-3 flex items-center justify-between">
          <p className="text-[11px] font-bold text-zinc-200 uppercase tracking-widest">Configure New Port</p>
          <button onClick={onClose} className="text-zinc-600 hover:text-white transition">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {unconfigured.length === 0 ? (
            <p className="text-xs text-zinc-500 text-center py-4">All detected interfaces already have IPs assigned.</p>
          ) : (
            <>
              {/* Mode toggle */}
              <div className="flex rounded-lg overflow-hidden border border-zinc-700 text-[11px] font-bold">
                <button onClick={() => setMode("dhcp")}
                  className={`flex-1 py-2 transition ${mode === "dhcp" ? "bg-emerald-700 text-white" : "bg-zinc-900 text-zinc-500 hover:text-zinc-200"}`}>
                  DHCP (Auto)
                </button>
                <button onClick={() => setMode("static")}
                  className={`flex-1 py-2 transition border-l border-zinc-700 ${mode === "static" ? "bg-indigo-700 text-white" : "bg-zinc-900 text-zinc-500 hover:text-zinc-200"}`}>
                  Static IP
                </button>
              </div>

              {/* Interface */}
              <div className="space-y-1.5">
                <label className="text-[9px] text-zinc-500 uppercase tracking-widest block">Interface</label>
                <div className="relative">
                  <select value={selIface} onChange={e => setSelIface(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500 appearance-none">
                    {unconfigured.map(i => (
                      <option key={i.name} value={i.name}>
                        {i.name}{i.mac ? ` — ${i.mac}` : ""}{i.up ? "" : " (DOWN)"}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-2.5 h-4 w-4 text-zinc-500 pointer-events-none" />
                </div>
              </div>

              {/* Static fields */}
              {mode === "static" && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-[9px] text-zinc-500 uppercase tracking-widest block">IP Address</label>
                    <input value={ipVal} onChange={e => setIpVal(e.target.value)} placeholder="10.0.0.1"
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-indigo-500" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] text-zinc-500 uppercase tracking-widest block">Subnet Mask</label>
                    <div className="relative">
                      <select value={maskVal} onChange={e => setMaskVal(e.target.value)}
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500 appearance-none">
                        {COMMON_MASKS.map(m => <option key={m.mask} value={m.mask}>{m.label}</option>)}
                      </select>
                      <ChevronDown className="absolute right-3 top-2.5 h-4 w-4 text-zinc-500 pointer-events-none" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] text-zinc-500 uppercase tracking-widest block">
                      Default Gateway <span className="text-zinc-700">(optional)</span>
                    </label>
                    <input value={gwVal} onChange={e => setGwVal(e.target.value)} placeholder="10.0.0.254"
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-indigo-500" />
                  </div>
                </>
              )}

              {msg && (
                <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] border ${
                  msg.ok ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                         : "bg-rose-500/10 border-rose-500/30 text-rose-400"
                }`}>
                  {msg.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <AlertCircle className="h-3.5 w-3.5 shrink-0" />}
                  {msg.text}
                </div>
              )}

              <button
                onClick={apply}
                disabled={applying || !selIface || (mode === "static" && !ipVal.trim())}
                className={`w-full py-2.5 rounded-lg disabled:opacity-40 transition flex items-center justify-center gap-2 text-sm font-bold text-white uppercase tracking-wider ${
                  mode === "dhcp" ? "bg-emerald-700 hover:bg-emerald-600" : "bg-indigo-600 hover:bg-indigo-500"
                }`}
              >
                {applying
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Applying…</>
                  : mode === "dhcp"
                    ? <><Wifi className="h-4 w-4" /> Enable DHCP</>
                    : <><Plus className="h-4 w-4" /> Assign Static IP</>}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Live uptime counter — isolated so ticking doesn't re-render the whole page ─

const LiveUptime = React.memo(function LiveUptime({ baseSec }: { baseSec: number }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="text-[11px] font-mono font-bold text-emerald-400">{fmtUptime(baseSec + tick)}</span>;
});

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function MePage() {
  const { isConnected } = useSocket();
  const [data,       setData]      = useState<ProfileStats | null>(null);
  const [ifaces,     setIfaces]    = useState<NetInterface[]>([]);
  const [loading,    setLoading]   = useState(true);
  const [netLoading, setNetLoad]   = useState(true);
  const [status,     setStatus]    = useState<NodeStatus | null>(null);
  const [showAddPort, setShowAddPort] = useState(false);

  // Track whether net has been initialised (so we don't overwrite user edits)
  const selIfaceRef = useRef("");

  // Configurator state
  const [selIface,  setSelIface]  = useState("");
  const [ipMode,    setIpMode]    = useState<"static" | "dhcp">("static");
  const [ipVal,     setIpVal]     = useState("");
  const [maskVal,   setMaskVal]   = useState("255.255.255.0");
  const [gwVal,     setGwVal]     = useState("");
  const [applying,  setApplying]  = useState(false);
  const [applyMsg,  setApplyMsg]  = useState<{ ok: boolean; text: string } | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const r = await fetch("/api/profile/stats");
      const d = await r.json();
      setData(d);
    } finally { setLoading(false); }
  }, []);

  const loadNet = useCallback(async (bust = false) => {
    setNetLoad(true);
    try {
      const r = await fetch(bust ? "/api/network?bust=1" : "/api/network");
      const d = await r.json();
      const list: NetInterface[] = (d.interfaces ?? []).filter((i: NetInterface) => !i.loopback);
      setIfaces(list);
      // Only auto-fill if user hasn't picked an interface yet
      if (!selIfaceRef.current) {
        const cur = list.find(i => i.ip) ?? list[0];
        if (cur) {
          selIfaceRef.current = cur.name;
          setSelIface(cur.name);
          setIpMode(cur.dhcp ? "dhcp" : "static");
          setIpVal(cur.ip ?? "");
          setMaskVal(cur.prefix ? cidrToMask(cur.prefix) : "255.255.255.0");
          setGwVal(cur.gateway ?? "");
        }
      }
    } finally { setNetLoad(false); }
  }, []); // no deps — uses ref for selIface

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/network/status");
      const d = await r.json();
      setStatus(d);
    } catch {}
  }, []);

  useEffect(() => { loadStats(); loadNet(); loadStatus(); }, []); // eslint-disable-line

  // Poll node status every 8 seconds (was 3s — reduces CPU & re-render churn)
  useEffect(() => {
    const t = setInterval(loadStatus, 8000);
    return () => clearInterval(t);
  }, [loadStatus]);

  const handleIfaceChange = (name: string) => {
    selIfaceRef.current = name;
    setSelIface(name);
    const cur = ifaces.find(i => i.name === name);
    if (cur) {
      setIpMode(cur.dhcp ? "dhcp" : "static");
      setIpVal(cur.ip ?? "");
      setMaskVal(cur.prefix ? cidrToMask(cur.prefix) : "255.255.255.0");
      setGwVal(cur.gateway ?? "");
    }
    setApplyMsg(null);
  };

  const applyConfig = async () => {
    setApplying(true);
    setApplyMsg(null);
    try {
      const body: any = { iface: selIface, mode: ipMode };
      if (ipMode === "static") {
        body.prefix  = maskToCidr(maskVal);
        body.ip      = ipVal;
        body.gateway = gwVal || undefined;
      }
      const res = await fetch("/api/network/set-ip", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      const label = ipMode === "dhcp"
        ? `${selIface}: DHCP enabled — waiting for lease…`
        : `${selIface}: ${ipVal}/${body.prefix} applied.`;
      setApplyMsg({ ok: true, text: label });
      loadNet(true);
    } catch (e: any) {
      setApplyMsg({ ok: false, text: e.message });
    } finally { setApplying(false); }
  };

  const curIface = ifaces.find(i => i.name === selIface);
  const memPct   = status ? Math.round((status.usedMem / status.totalMem) * 100) : 0;

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#313338] overflow-y-auto">
      {showAddPort && (
        <AddPortModal
          ifaces={ifaces}
          onClose={() => setShowAddPort(false)}
          onApplied={() => { setShowAddPort(false); loadNet(); }}
        />
      )}

      <div className="flex flex-col flex-1 p-6 max-w-4xl mx-auto w-full">

        {/* Header */}
        {data?.profile && (
          <div className="flex items-center gap-x-4 mb-8">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-xl font-bold text-white shadow-lg shadow-indigo-500/30 shrink-0">
              {data.profile.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-black dark:text-white">{data.profile.name}</h1>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Member since {format(new Date(data.profile.createdAt), "d MMM yyyy")}
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* ── Activity + Node Status ─────────────────────────── */}
          <div className="bg-zinc-100 dark:bg-[#2b2d31] rounded-2xl p-5 border border-black/5 dark:border-white/5 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-x-2">
              <Clock className="h-3.5 w-3.5" /> Activity
            </h3>

            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-zinc-500" /></div>
            ) : data ? (
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Messages",  value: data.stats.messages, color: "text-indigo-400" },
                  { label: "DMs",       value: data.stats.dms,      color: "text-purple-400" },
                  { label: "Servers",   value: data.stats.servers,  color: "text-emerald-400" },
                  { label: "Calls",     value: data.stats.calls,    color: "text-cyan-400"   },
                  { label: "Missed",    value: data.stats.missed,   color: "text-rose-400"   },
                ].map(s => (
                  <div key={s.label} className="flex items-center justify-between bg-black/10 dark:bg-black/20 rounded-lg px-3 py-2.5">
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider">{s.label}</span>
                    <span className={`text-sm font-bold font-mono ${s.color}`}>{s.value}</span>
                  </div>
                ))}
              </div>
            ) : null}

            <Separator className="bg-zinc-200 dark:bg-zinc-700" />

            {/* ── Live Node Status ─────────────────────────────── */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-x-1.5">
                  <Activity className="h-3 w-3" /> Node Status
                </span>
                {/* Connectivity pill */}
                <span className={`flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                  isConnected
                    ? "text-emerald-400 border-emerald-700 bg-emerald-900/30"
                    : "text-rose-400 border-rose-700 bg-rose-900/30"
                }`}>
                  {isConnected
                    ? <><span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"/><span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"/></span> Online</>
                    : <><WifiOff className="h-3 w-3" /> Offline</>}
                </span>
              </div>

              {/* Uptime — rendered in isolated memoized component so tick doesn't re-render rest of page */}
              <div className="flex items-center justify-between bg-black/10 dark:bg-black/20 rounded-lg px-3 py-2">
                <span className="text-[10px] text-zinc-500">Uptime</span>
                {status ? <LiveUptime baseSec={status.uptimeSec} /> : <span className="text-[11px] font-mono text-zinc-600">—</span>}
              </div>

              {/* Memory */}
              {status && (
                <div className="bg-black/10 dark:bg-black/20 rounded-lg px-3 py-2 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-zinc-500 flex items-center gap-1">
                      <MemoryStick className="h-3 w-3" /> Memory
                    </span>
                    <span className="text-[10px] font-mono text-zinc-300">
                      {fmtBytes(status.usedMem)} / {fmtBytes(status.totalMem)}
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${
                        memPct > 85 ? "bg-rose-500" : memPct > 65 ? "bg-yellow-500" : "bg-indigo-500"
                      }`}
                      style={{ width: `${memPct}%` }}
                    />
                  </div>
                </div>
              )}

              {/* CPU */}
              {status && (
                <div className="bg-black/10 dark:bg-black/20 rounded-lg px-3 py-2 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-zinc-500 flex items-center gap-1">
                      <Cpu className="h-3 w-3" /> CPU
                    </span>
                    <span className="text-[10px] font-mono text-zinc-300">{status.cpuPct}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${
                        status.cpuPct > 85 ? "bg-rose-500" : status.cpuPct > 65 ? "bg-yellow-500" : "bg-cyan-500"
                      }`}
                      style={{ width: `${status.cpuPct}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Platform / hostname */}
              {status && (
                <div className="flex gap-2 text-[10px] font-mono">
                  <span className="text-zinc-700">{status.hostname}</span>
                  <span className="text-zinc-700">·</span>
                  <span className="text-zinc-700">{status.platform}</span>
                </div>
              )}
            </div>
          </div>

          {/* ── Cisco-style IP Configurator ────────────────────── */}
          <div className="bg-[#1a1c1e] rounded-2xl border border-zinc-800 overflow-hidden font-mono">
            {/* Title bar */}
            <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold text-zinc-200 uppercase tracking-widest">Interface Configuration</p>
                <p className="text-[9px] text-zinc-600 mt-0.5">{ipMode === "dhcp" ? "DHCP" : "Static IP"} · CyberDeck Node</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowAddPort(true)}
                  title="Configure unconfigured port"
                  className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold bg-emerald-800/50 hover:bg-emerald-700/60 text-emerald-400 border border-emerald-800 transition"
                >
                  <Plus className="h-3 w-3" /> Add Port
                </button>
                <button onClick={() => loadNet(true)} disabled={netLoading}
                  className="p-1.5 rounded hover:bg-zinc-800 text-zinc-600 hover:text-zinc-300 transition">
                  <RefreshCw className={`h-3.5 w-3.5 ${netLoading ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>

            <div className="p-4 space-y-4">

              {/* ── DHCP / Static toggle ── */}
              <div className="flex rounded-lg overflow-hidden border border-zinc-700 text-[11px] font-bold">
                <button
                  onClick={() => { setIpMode("dhcp"); setApplyMsg(null); }}
                  className={`flex-1 py-2 transition ${
                    ipMode === "dhcp"
                      ? "bg-emerald-700 text-white"
                      : "bg-zinc-900 text-zinc-500 hover:text-zinc-200"
                  }`}
                >
                  DHCP (Auto)
                </button>
                <button
                  onClick={() => { setIpMode("static"); setApplyMsg(null); }}
                  className={`flex-1 py-2 transition border-l border-zinc-700 ${
                    ipMode === "static"
                      ? "bg-indigo-700 text-white"
                      : "bg-zinc-900 text-zinc-500 hover:text-zinc-200"
                  }`}
                >
                  Static IP
                </button>
              </div>

              {/* Interface selector */}
              <div className="space-y-1.5">
                <label className="text-[9px] text-zinc-500 uppercase tracking-widest block">Interface</label>
                <div className="relative">
                  <select
                    value={selIface}
                    onChange={e => handleIfaceChange(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500 appearance-none cursor-pointer"
                  >
                    {ifaces.length === 0 && <option value="">No interfaces detected</option>}
                    {ifaces.map(i => (
                      <option key={i.name} value={i.name}>
                        {i.name}{i.dhcp ? " — DHCP" : i.ip ? ` — ${i.ip}` : " — unassigned"}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-2.5 h-4 w-4 text-zinc-500 pointer-events-none" />
                </div>
                <div className="flex items-center justify-between px-1">
                  <span className="text-[9px] text-zinc-600">{curIface?.mac ?? "—"}</span>
                  <div className="flex items-center gap-2">
                    {curIface?.dhcp && (
                      <span className="text-[9px] font-bold text-emerald-600 uppercase">DHCP</span>
                    )}
                    <span className={`text-[9px] font-bold uppercase ${curIface?.up ? "text-emerald-500" : "text-rose-500"}`}>
                      {curIface ? (curIface.up ? "● UP" : "● DOWN") : "—"}
                    </span>
                  </div>
                </div>
              </div>

              {/* DHCP info panel */}
              {ipMode === "dhcp" && (
                <div className="rounded-lg border border-emerald-800/50 bg-emerald-900/20 px-4 py-3 space-y-1.5">
                  <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">Automatic (DHCP)</p>
                  <p className="text-[10px] text-zinc-500 leading-relaxed">
                    The interface will request an IP address, subnet mask, and gateway automatically from a DHCP server on the network.
                  </p>
                  {curIface?.ip && (
                    <div className="pt-1 space-y-0.5">
                      <div className="flex justify-between text-[10px]">
                        <span className="text-zinc-600">Leased IP</span>
                        <span className="text-emerald-400 font-mono">{curIface.ip}/{curIface.prefix}</span>
                      </div>
                      {curIface.gateway && (
                        <div className="flex justify-between text-[10px]">
                          <span className="text-zinc-600">Gateway</span>
                          <span className="text-emerald-400 font-mono">{curIface.gateway}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Static fields — only shown in static mode */}
              {ipMode === "static" && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-[9px] text-zinc-500 uppercase tracking-widest block">IP Address</label>
                    <input
                      value={ipVal} onChange={e => setIpVal(e.target.value)}
                      placeholder="10.0.0.1"
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[9px] text-zinc-500 uppercase tracking-widest block">Subnet Mask</label>
                    <div className="relative">
                      <select
                        value={maskVal} onChange={e => setMaskVal(e.target.value)}
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500 appearance-none cursor-pointer"
                      >
                        {COMMON_MASKS.map(m => (
                          <option key={m.mask} value={m.mask}>{m.label}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-2.5 h-4 w-4 text-zinc-500 pointer-events-none" />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[9px] text-zinc-500 uppercase tracking-widest block">
                      Default Gateway <span className="text-zinc-700">(optional)</span>
                    </label>
                    <input
                      value={gwVal} onChange={e => setGwVal(e.target.value)}
                      placeholder="10.0.0.254"
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </>
              )}

              {/* Status message */}
              {applyMsg && (
                <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] border ${
                  applyMsg.ok
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                    : "bg-rose-500/10 border-rose-500/30 text-rose-400"
                }`}>
                  {applyMsg.ok
                    ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    : <AlertCircle  className="h-3.5 w-3.5 shrink-0" />}
                  {applyMsg.text}
                </div>
              )}

              {/* Apply button */}
              <button
                onClick={applyConfig}
                disabled={applying || !selIface || (ipMode === "static" && !ipVal.trim())}
                className={`w-full py-2.5 rounded-lg disabled:opacity-40 transition flex items-center justify-center gap-2 text-sm font-bold text-white uppercase tracking-wider ${
                  ipMode === "dhcp" ? "bg-emerald-700 hover:bg-emerald-600" : "bg-indigo-600 hover:bg-indigo-500"
                }`}
              >
                {applying
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Applying…</>
                  : ipMode === "dhcp"
                    ? <><Wifi className="h-4 w-4" /> Enable DHCP</>
                    : <><Save className="h-4 w-4" /> Apply Static IP</>}
              </button>

              {/* Running config summary */}
              <div className="bg-zinc-900/60 rounded-lg px-3 py-2.5 space-y-1 border border-zinc-800">
                <p className="text-[9px] text-zinc-600 uppercase tracking-widest mb-2">Running Config</p>
                <div className="flex justify-between text-[10px]">
                  <span className="text-zinc-600">interface</span>
                  <span className="text-zinc-300">{selIface || "—"}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-zinc-600">ip address</span>
                  <span className={ipMode === "dhcp" ? "text-emerald-500" : "text-zinc-300"}>
                    {ipMode === "dhcp" ? "dhcp" : `${ipVal || "—"} ${maskVal}`}
                  </span>
                </div>
                {ipMode === "static" && (
                  <div className="flex justify-between text-[10px]">
                    <span className="text-zinc-600">ip default-gateway</span>
                    <span className="text-zinc-300">{gwVal || "—"}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── All Interfaces Table ──────────────────────────────── */}
        <div className="mt-6 bg-[#1a1c1e] rounded-2xl border border-zinc-800 overflow-hidden font-mono">
          <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-3">
            <p className="text-[11px] font-bold text-zinc-200 uppercase tracking-widest">Network Ports</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="px-4 py-2 text-left text-[9px] text-zinc-600 uppercase tracking-widest font-bold">Interface</th>
                  <th className="px-4 py-2 text-left text-[9px] text-zinc-600 uppercase tracking-widest font-bold">IP Address</th>
                  <th className="px-4 py-2 text-left text-[9px] text-zinc-600 uppercase tracking-widest font-bold">Subnet</th>
                  <th className="px-4 py-2 text-left text-[9px] text-zinc-600 uppercase tracking-widest font-bold">Gateway</th>
                  <th className="px-4 py-2 text-left text-[9px] text-zinc-600 uppercase tracking-widest font-bold">MAC</th>
                  <th className="px-4 py-2 text-left text-[9px] text-zinc-600 uppercase tracking-widest font-bold">Status</th>
                </tr>
              </thead>
              <tbody>
                {ifaces.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-zinc-600">
                      {netLoading ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : "No interfaces found"}
                    </td>
                  </tr>
                ) : ifaces.map(i => (
                  <tr
                    key={i.name}
                    onClick={() => handleIfaceChange(i.name)}
                    className={`border-b border-zinc-800/50 cursor-pointer transition ${
                      i.name === selIface ? "bg-indigo-900/20" : "hover:bg-zinc-800/30"
                    }`}
                  >
                    <td className="px-4 py-2.5 font-bold text-zinc-200">
                      <div className="flex items-center gap-1.5">
                        {i.name}
                        {i.dhcp && (
                          <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded bg-emerald-900/60 text-emerald-400 border border-emerald-800">
                            DHCP
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-zinc-300">{i.ip ?? <span className="text-zinc-700">unassigned</span>}</td>
                    <td className="px-4 py-2.5 text-zinc-500">{i.prefix ? `/${i.prefix}` : "—"}</td>
                    <td className="px-4 py-2.5 text-zinc-500">{i.gateway ?? "—"}</td>
                    <td className="px-4 py-2.5 text-zinc-600">{i.mac ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className={`font-bold ${i.up ? "text-emerald-500" : "text-rose-500"}`}>
                        {i.up ? "● UP" : "● DOWN"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Call History ──────────────────────────────────────── */}
        <div className="mt-6 bg-zinc-100 dark:bg-[#2b2d31] rounded-2xl p-5 border border-black/5 dark:border-white/5">
          <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-4 flex items-center gap-x-2">
            <Video className="h-3.5 w-3.5" /> Call History
          </h3>
          <ScrollArea className="max-h-72">
            {!data || data.callHistory.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 opacity-40">
                <Phone className="h-8 w-8 mb-2" />
                <p className="text-xs">No calls recorded yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {data.callHistory.map((call: any) => (
                  <div key={call.id}
                    className="flex items-center justify-between px-4 py-3 bg-white/50 dark:bg-black/20 rounded-xl border border-black/5 dark:border-white/5">
                    <div className="flex items-center gap-x-3">
                      {call.type === "video"
                        ? <Video className="h-4 w-4 text-indigo-400 shrink-0" />
                        : <Phone className="h-4 w-4 text-emerald-400 shrink-0" />}
                      <div>
                        <p className="text-xs font-bold capitalize text-zinc-200">{call.type} Call</p>
                        <p className="text-[10px] text-zinc-500 font-mono">
                          {format(new Date(call.startedAt), "d MMM yyyy, HH:mm")}
                          {" · "}
                          {formatDistanceToNow(new Date(call.startedAt), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-[10px] font-bold uppercase ${statusColor(call.status)}`}>{call.status}</p>
                      {call.duration > 0 && (
                        <p className="text-[10px] text-zinc-500 font-mono">
                          {Math.floor(call.duration / 60)}m {call.duration % 60}s
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

      </div>
    </div>
  );
}
