"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  RefreshCw, Trash2, Loader2, Terminal, HardDrive, Server,
  AlertCircle, Info, AlertTriangle, Zap, ArrowLeft,
} from "lucide-react";
import { useSocket } from "@/components/providers/socket-provider";

// Load xterm component only on the client — it uses browser-only DOM APIs.
const TerminalXterm = dynamic(
  () => import("@/components/terminal/terminal-xterm"),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center flex-1 text-zinc-500 text-sm">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading terminal…
      </div>
    ),
  }
);

type Source = "app" | "system" | "disk" | "terminal";

interface LogEntry {
  ts: string; level: string; message: string; raw: string;
}

const LEVEL_STYLES: Record<string, string> = {
  INFO:   "text-zinc-400",
  EVENT:  "text-indigo-400",
  WARN:   "text-yellow-400",
  ERROR:  "text-rose-400",
  SYSTEM: "text-emerald-400",
  DISK:   "text-blue-400",
};

const LEVEL_ICONS: Record<string, React.ReactNode> = {
  INFO:   <Info          className="h-3 w-3 shrink-0" />,
  EVENT:  <Zap           className="h-3 w-3 shrink-0 text-indigo-400" />,
  WARN:   <AlertTriangle className="h-3 w-3 shrink-0 text-yellow-400" />,
  ERROR:  <AlertCircle   className="h-3 w-3 shrink-0 text-rose-400" />,
};

const LOG_SOURCES: { id: Exclude<Source, "terminal">; label: string; Icon: any }[] = [
  { id: "app",    label: "App Events", Icon: Terminal  },
  { id: "system", label: "System",     Icon: Server    },
  { id: "disk",   label: "Disk",       Icon: HardDrive },
];

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function LogsPage() {
  const [source,      setSource]      = useState<Source>("app");
  const [entries,     setEntries]     = useState<LogEntry[]>([]);
  const [logSize,     setLogSize]     = useState(0);
  const [loading,     setLoading]     = useState(true);
  const [clearing,    setClearing]    = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [filter,      setFilter]      = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const { socket }  = useSocket();

  const load = useCallback(async (src: Exclude<Source, "terminal">) => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/logs?source=${src}`);
      const data = await res.json();
      setEntries(data.entries ?? []);
      setLogSize(data.logSize ?? 0);
    } catch {
      setEntries([{ ts: "", level: "ERROR", message: "Could not load logs.", raw: "" }]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (source !== "terminal") load(source as any);
  }, [source, load]);

  useEffect(() => {
    if (!autoRefresh || source === "terminal") return;
    const t = setInterval(() => load(source as any), 5000);
    return () => clearInterval(t);
  }, [autoRefresh, source, load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries]);

  const clearLog = async () => {
    if (!confirm("Clear the app log?")) return;
    setClearing(true);
    await fetch("/api/logs", { method: "DELETE" });
    await load("app");
    setClearing(false);
  };

  const filtered = filter
    ? entries.filter(e => e.raw.toLowerCase().includes(filter.toLowerCase()))
    : entries;

  return (
    <div className="min-h-screen bg-[#0d1117] text-zinc-200 font-mono flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#0d1117]/95 backdrop-blur border-b border-zinc-800 px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-x-3">
            <button
              onClick={() => window.location.href = "/"}
              className="p-1.5 -ml-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition flex items-center gap-2 pr-3"
              title="Go Back"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="text-xs font-bold uppercase tracking-wider">Back</span>
            </button>
            <span className="text-sm text-zinc-400 uppercase tracking-widest">
              {source === "terminal" ? "Terminal" : "System Logs"}
            </span>
          </div>
          <div className="flex items-center gap-x-2">
            {source === "app" && logSize > 0 && (
              <span className="text-[10px] text-zinc-600">{(logSize / 1024).toFixed(1)} KB</span>
            )}
            {source !== "terminal" && (
              <>
                <button
                  onClick={() => setAutoRefresh(r => !r)}
                  className={`text-[10px] px-2 py-1 rounded-lg border transition ${
                    autoRefresh ? "border-emerald-600 text-emerald-400" : "border-zinc-700 text-zinc-500 hover:text-white"
                  }`}
                >
                  {autoRefresh ? "● LIVE" : "Live"}
                </button>
                <button onClick={() => load(source as any)} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-white">
                  <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                </button>
              </>
            )}
            {source === "app" && (
              <button onClick={clearLog} disabled={clearing} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-rose-400 disabled:opacity-40">
                {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-x-1">
          {LOG_SOURCES.map(s => (
            <button key={s.id} onClick={() => setSource(s.id)}
              className={`flex items-center gap-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                source === s.id ? "bg-indigo-600 text-white" : "text-zinc-500 hover:text-white hover:bg-zinc-800"
              }`}
            >
              <s.Icon className="h-3.5 w-3.5" /> {s.label}
            </button>
          ))}
          {/* Terminal tab */}
          <button onClick={() => setSource("terminal")}
            className={`flex items-center gap-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              source === "terminal" ? "bg-emerald-700 text-white" : "text-zinc-500 hover:text-white hover:bg-zinc-800"
            }`}
          >
            <Terminal className="h-3.5 w-3.5" /> Terminal
          </button>
        </div>

        {/* Filter — only for log sources */}
        {source !== "terminal" && (
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter logs…"
            className="w-full bg-zinc-900 text-zinc-200 text-xs px-3 py-2 rounded-xl border border-zinc-800 focus:outline-none focus:border-indigo-600 placeholder-zinc-600"
          />
        )}
      </div>

      {/* Terminal pane */}
      {source === "terminal" ? (
        <div className="flex flex-col flex-1 overflow-hidden">
          <TerminalXterm socket={socket} />
        </div>
      ) : (
        <>
          {/* Log output */}
          <div className="touch-scroll flex-1 overflow-y-auto px-4 py-4">
            {loading ? (
              <div className="flex items-center justify-center py-20 text-zinc-500">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-zinc-600 text-sm">
                <Terminal className="h-12 w-12 opacity-20 mb-3" />
                {filter ? "No entries match the filter." : "No log entries yet."}
              </div>
            ) : (
              <div className="space-y-0.5">
                {filtered.map((e, i) => {
                  const lvl   = e.level.toUpperCase();
                  const style = LEVEL_STYLES[lvl] ?? "text-zinc-400";
                  const icon  = LEVEL_ICONS[lvl]  ?? <Info className="h-3 w-3 shrink-0 text-zinc-600" />;
                  return (
                    <div key={i} className={`flex items-start gap-x-2 py-0.5 text-[11px] leading-5 font-mono ${style} hover:bg-zinc-800/40 px-2 rounded`}>
                      <span className="text-zinc-700 shrink-0 select-none w-[160px] truncate">
                        {e.ts ? e.ts.replace("T", " ").replace(/\.\d+Z$/, "") : ""}
                      </span>
                      {icon}
                      <span className={`font-bold w-10 shrink-0 ${style}`}>{e.level}</span>
                      <span className="break-all flex-1 text-zinc-300">{e.message}</span>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          <div className="border-t border-zinc-800 px-4 py-2 flex items-center justify-between text-[10px] text-zinc-700">
            <span>{filtered.length} entries{filter ? ` (filtered from ${entries.length})` : ""}</span>
            <span>{autoRefresh ? "Auto-refresh: 5s" : "Manual refresh"}</span>
          </div>
        </>
      )}
    </div>
  );
}
