"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  HardDrive, Folder, File, FileImage, FileVideo, FileAudio,
  Archive, FileText, FileType, ChevronRight, Download,
  Copy, ArrowLeft, RefreshCw, Usb, AlertCircle, Loader2,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Drive {
  slot: string;
  mountPoint: string;
  label?: string;
  freeBytes?: number;
  totalBytes?: number;
}

interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  sizeHuman: string;
  modified: number;
  mimeGroup: string;
}

interface Crumb { name: string; path: string; }

interface DirListing {
  path: string;
  crumbs: Crumb[];
  items: FileEntry[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function humanBytes(b?: number) {
  if (b === undefined) return "—";
  if (b >= 1073741824) return `${(b / 1073741824).toFixed(1)} GB`;
  if (b >= 1048576)    return `${(b / 1048576).toFixed(1)} MB`;
  return `${Math.round(b / 1024)} KB`;
}

function FileIcon({ group, className }: { group: string; className?: string }) {
  const cls = `shrink-0 ${className ?? "h-5 w-5"}`;
  switch (group) {
    case "folder":  return <Folder      className={`${cls} text-yellow-400`} />;
    case "image":   return <FileImage   className={`${cls} text-emerald-400`} />;
    case "video":   return <FileVideo   className={`${cls} text-blue-400`} />;
    case "audio":   return <FileAudio   className={`${cls} text-purple-400`} />;
    case "pdf":     return <FileType    className={`${cls} text-red-400`} />;
    case "archive": return <Archive     className={`${cls} text-orange-400`} />;
    case "text":    return <FileText    className={`${cls} text-zinc-300`} />;
    default:        return <File        className={`${cls} text-zinc-500`} />;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function FilesPage() {
  const [drives,      setDrives]      = useState<Drive[]>([]);
  const [listing,     setListing]     = useState<DirListing | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [browsing,    setBrowsing]    = useState(false);
  const [copying,     setCopying]     = useState<string | null>(null);
  const [copyDone,    setCopyDone]    = useState<string | null>(null);
  const [error,       setError]       = useState<string | null>(null);

  // ── Load drives ─────────────────────────────────────────────────────────────
  const loadDrives = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch("/api/usb");
      const data = await res.json();
      setDrives(data.drives ?? []);
    } catch {
      setError("Could not reach USB API.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadDrives(); }, [loadDrives]);

  // ── Browse a directory ───────────────────────────────────────────────────────
  const browse = useCallback(async (path: string) => {
    setBrowsing(true);
    setError(null);
    try {
      const res  = await fetch(`/api/usb/files?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setListing(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBrowsing(false);
    }
  }, []);

  // ── Download ─────────────────────────────────────────────────────────────────
  const download = (path: string) => {
    const a = document.createElement("a");
    a.href = `/api/usb/download?path=${encodeURIComponent(path)}`;
    a.click();
  };

  // ── Copy to CyberDeck ────────────────────────────────────────────────────────
  const copyToDevice = async (path: string) => {
    setCopying(path);
    setCopyDone(null);
    setError(null);
    try {
      const res  = await fetch("/api/usb/copy", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ srcPath: path }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setCopyDone(path);
      setTimeout(() => setCopyDone(null), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCopying(null);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#0d1117] text-zinc-200 font-mono">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#0d1117]/95 backdrop-blur border-b border-zinc-800 px-6 py-4 flex items-center gap-x-3">
        {listing ? (
          <button
            onClick={() => {
              const parent = listing.crumbs.length > 1
                ? listing.crumbs[listing.crumbs.length - 2].path
                : null;
              if (parent) browse(parent); else setListing(null);
            }}
            className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        ) : (
          <button
            onClick={() => window.history.back()}
            className="p-1 -ml-1 rounded-lg hover:bg-zinc-800 text-indigo-400 hover:text-indigo-300 transition"
            title="Go Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}

        <div className="flex-1 flex items-center gap-x-2 overflow-hidden">
          {listing ? (
            // Breadcrumb
            <div className="flex items-center gap-x-1 text-sm overflow-x-auto">
              <button
                onClick={() => setListing(null)}
                className="text-indigo-400 hover:text-indigo-300 shrink-0"
              >
                Drives
              </button>
              {listing.crumbs.map((c, i) => (
                <React.Fragment key={c.path}>
                  <ChevronRight className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
                  <button
                    onClick={() => browse(c.path)}
                    className={
                      i === listing.crumbs.length - 1
                        ? "text-white truncate"
                        : "text-zinc-400 hover:text-white shrink-0"
                    }
                  >
                    {c.name}
                  </button>
                </React.Fragment>
              ))}
            </div>
          ) : (
            <span className="text-sm text-zinc-400 uppercase tracking-widest">
              USB File Manager
            </span>
          )}
        </div>

        <button
          onClick={() => listing ? browse(listing.path) : loadDrives()}
          className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-white transition"
        >
          <RefreshCw className={`h-4 w-4 ${(loading || browsing) ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6">
        {/* Error banner */}
        {error && (
          <div className="mb-4 flex items-center gap-x-2 bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Copy success */}
        {copyDone && (
          <div className="mb-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3 text-emerald-400 text-sm">
            Copied to CyberDeck successfully.
          </div>
        )}

        {/* Drive list */}
        {!listing && (
          <>
            {loading ? (
              <div className="flex items-center justify-center py-20 text-zinc-500">
                <Loader2 className="h-6 w-6 animate-spin mr-3" /> Scanning for USB drives…
              </div>
            ) : drives.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-y-4 text-zinc-500">
                <Usb className="h-16 w-16 opacity-20" />
                <p className="text-sm">No USB drives detected.</p>
                <p className="text-xs">Plug in a pen drive and hit refresh.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-zinc-600 uppercase tracking-widest mb-4">
                  {drives.length} drive{drives.length > 1 ? "s" : ""} connected
                </p>
                {drives.map((d) => {
                  const used  = (d.totalBytes && d.freeBytes) ? d.totalBytes - d.freeBytes : undefined;
                  const pct   = (d.totalBytes && used !== undefined) ? Math.round((used / d.totalBytes) * 100) : undefined;
                  return (
                    <button
                      key={d.slot}
                      onClick={() => browse(d.mountPoint)}
                      className="w-full bg-zinc-900/60 hover:bg-zinc-800/80 border border-zinc-800 hover:border-zinc-700 rounded-2xl px-5 py-4 flex items-center gap-x-4 transition group text-left"
                    >
                      <div className="h-12 w-12 rounded-xl bg-indigo-500/15 flex items-center justify-center shrink-0">
                        <HardDrive className="h-6 w-6 text-indigo-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-white truncate">
                          {d.label ?? d.slot.toUpperCase()}
                        </p>
                        <p className="text-xs text-zinc-500 mt-0.5">
                          {d.mountPoint}
                          {d.freeBytes !== undefined && (
                            <> · {humanBytes(d.freeBytes)} free</>
                          )}
                          {d.totalBytes !== undefined && (
                            <> / {humanBytes(d.totalBytes)}</>
                          )}
                        </p>
                        {pct !== undefined && (
                          <div className="mt-2 h-1 bg-zinc-800 rounded-full overflow-hidden w-48">
                            <div
                              className="h-full bg-indigo-500 rounded-full transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        )}
                      </div>
                      <ChevronRight className="h-5 w-5 text-zinc-600 group-hover:text-zinc-300 group-hover:translate-x-1 transition shrink-0" />
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* File listing */}
        {listing && (
          <>
            {browsing ? (
              <div className="flex items-center justify-center py-20 text-zinc-500">
                <Loader2 className="h-6 w-6 animate-spin mr-3" /> Loading…
              </div>
            ) : listing.items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-y-3 text-zinc-500">
                <Folder className="h-16 w-16 opacity-20" />
                <p className="text-sm">This folder is empty.</p>
              </div>
            ) : (
              <div className="space-y-1">
                {listing.items.map((item) => (
                  <div
                    key={item.path}
                    className="flex items-center gap-x-3 px-3 py-2.5 rounded-xl hover:bg-zinc-800/60 group transition"
                  >
                    {/* Icon */}
                    <FileIcon group={item.mimeGroup} />

                    {/* Name + meta */}
                    <button
                      onClick={() => item.isDir ? browse(item.path) : undefined}
                      className={`flex-1 min-w-0 text-left ${item.isDir ? "cursor-pointer" : "cursor-default"}`}
                    >
                      <p className="text-sm text-white truncate group-hover:text-indigo-300 transition">
                        {item.name}
                      </p>
                      <p className="text-[10px] text-zinc-600 mt-0.5">
                        {item.isDir
                          ? "Folder"
                          : item.sizeHuman}
                        {item.modified > 0 && (
                          <> · {new Date(item.modified).toLocaleDateString()}</>
                        )}
                      </p>
                    </button>

                    {/* Actions — files only */}
                    {!item.isDir && (
                      <div className="flex items-center gap-x-1 opacity-0 group-hover:opacity-100 transition shrink-0">
                        <button
                          onClick={() => download(item.path)}
                          title="Download to browser"
                          className="p-1.5 rounded-lg hover:bg-zinc-700 text-zinc-400 hover:text-white transition"
                        >
                          <Download className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => copyToDevice(item.path)}
                          disabled={copying === item.path}
                          title="Copy to CyberDeck"
                          className="p-1.5 rounded-lg hover:bg-zinc-700 text-zinc-400 hover:text-emerald-400 transition disabled:opacity-40"
                        >
                          {copying === item.path
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <Copy className="h-4 w-4" />}
                        </button>
                      </div>
                    )}

                    {/* Folder chevron */}
                    {item.isDir && (
                      <button onClick={() => browse(item.path)}>
                        <ChevronRight className="h-4 w-4 text-zinc-600 group-hover:text-zinc-400 transition shrink-0" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
