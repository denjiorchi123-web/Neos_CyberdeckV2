"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Folder, File, FileImage, FileVideo, FileAudio, FileText, FileType,
  Archive, ChevronRight, ChevronUp, RefreshCw, Loader2, AlertCircle,
  Plus, Trash2, Pencil, Copy, Scissors, Clipboard, FolderPlus,
  FilePlus, Save, X, Check, FolderOpen,
} from "lucide-react";
import os from "os";

// ── Types ─────────────────────────────────────────────────────────────────────

interface FsEntry {
  name: string; path: string; isDir: boolean;
  size: number; sizeHuman: string; modified: number; mimeGroup: string;
}
interface Crumb { name: string; path: string; }
interface Listing { path: string; crumbs: Crumb[]; items: FsEntry[]; }
type ClipAction = "copy" | "cut";
interface Clip { action: ClipAction; paths: string[]; }

// ── Helpers ───────────────────────────────────────────────────────────────────

function defaultRoot(): string {
  if (typeof window === "undefined") return "/";
  // Can't call os.homedir() in browser — derive from known roots
  return "/";
}

const WIN = typeof process !== "undefined" && process.platform === "win32";

function FileIcon({ group, className }: { group: string; className?: string }) {
  const cls = `shrink-0 ${className ?? "h-4 w-4"}`;
  switch (group) {
    case "folder":  return <Folder    className={`${cls} text-yellow-400`} />;
    case "image":   return <FileImage className={`${cls} text-emerald-400`} />;
    case "video":   return <FileVideo className={`${cls} text-blue-400`} />;
    case "audio":   return <FileAudio className={`${cls} text-purple-400`} />;
    case "pdf":     return <FileType  className={`${cls} text-red-400`} />;
    case "archive": return <Archive   className={`${cls} text-orange-400`} />;
    case "text":    return <FileText  className={`${cls} text-zinc-300`} />;
    default:        return <File      className={`${cls} text-zinc-500`} />;
  }
}

function parentOf(p: string): string {
  const sep   = p.includes("/") ? "/" : "\\";
  const parts = p.replace(/[/\\]+$/, "").split(/[/\\]/);
  if (parts.length <= 1) return p;
  const parent = parts.slice(0, -1).join(sep) || sep;
  return parent;
}

function basename(p: string): string {
  return p.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? p;
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function FileManagerPage() {
  const [listing,     setListing]     = useState<Listing | null>(null);
  const [selected,    setSelected]    = useState<Set<string>>(new Set());
  const [clip,        setClip]        = useState<Clip | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [toast,       setToast]       = useState<string | null>(null);

  // rename/create inline state
  const [renaming,    setRenaming]    = useState<string | null>(null);
  const [renameVal,   setRenameVal]   = useState("");
  const [creating,    setCreating]    = useState<"file" | "dir" | null>(null);
  const [createName,  setCreateName]  = useState("");

  // text editor state
  const [editPath,    setEditPath]    = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editDirty,   setEditDirty]   = useState(false);
  const [editSaving,  setEditSaving]  = useState(false);
  const [editLoading, setEditLoading] = useState(false);

  // ── Navigation ─────────────────────────────────────────────────────────────

  const browse = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    setSelected(new Set());
    try {
      const res  = await fetch(`/api/fs?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setListing(data);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    // Start at home dir (Linux) or C:\ (Windows) — detected server-side
    fetch("/api/fs/root").then(r => r.json()).then(d => browse(d.root)).catch(() => browse("/"));
  }, [browse]);

  // ── Selection helpers ──────────────────────────────────────────────────────

  const toggleSelect = (path: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  };

  const selectAll = () => {
    if (!listing) return;
    setSelected(new Set(listing.items.map(i => i.path)));
  };

  // ── Clipboard ──────────────────────────────────────────────────────────────

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  const copy = () => { if (selected.size) { setClip({ action: "copy", paths: [...selected] }); flash(`Copied ${selected.size} item(s)`); } };
  const cut  = () => { if (selected.size) { setClip({ action: "cut",  paths: [...selected] }); flash(`Cut ${selected.size} item(s)`); } };

  const paste = async () => {
    if (!clip || !listing) return;
    for (const src of clip.paths) {
      const dest = (listing.path.replace(/[/\\]+$/, "")) +
                   (WIN ? "\\" : "/") + basename(src);
      const endpoint = clip.action === "copy" ? "/api/fs/copy" : "/api/fs/move";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: src, to: dest }),
      });
      const d = await res.json();
      if (d.error) { setError(d.error); return; }
    }
    if (clip.action === "cut") setClip(null);
    flash("Pasted.");
    browse(listing.path);
  };

  // ── Delete ─────────────────────────────────────────────────────────────────

  const deleteSelected = async () => {
    if (!selected.size || !confirm(`Delete ${selected.size} item(s)?`)) return;
    for (const p of selected) {
      const res = await fetch(`/api/fs?path=${encodeURIComponent(p)}`, { method: "DELETE" });
      const d   = await res.json();
      if (d.error) { setError(d.error); return; }
    }
    setSelected(new Set());
    flash("Deleted.");
    if (listing) browse(listing.path);
  };

  // ── Rename ─────────────────────────────────────────────────────────────────

  const startRename = (item: FsEntry) => {
    setRenaming(item.path);
    setRenameVal(item.name);
  };

  const commitRename = async () => {
    if (!renaming || !renameVal.trim() || !listing) return;
    const dir  = parentOf(renaming);
    const dest = dir.replace(/[/\\]+$/, "") + (WIN ? "\\" : "/") + renameVal.trim();
    const res  = await fetch("/api/fs/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: renaming, to: dest }),
    });
    const d = await res.json();
    if (d.error) { setError(d.error); } else { flash("Renamed."); browse(listing.path); }
    setRenaming(null);
  };

  // ── Create ─────────────────────────────────────────────────────────────────

  const commitCreate = async () => {
    if (!creating || !createName.trim() || !listing) return;
    const path = listing.path.replace(/[/\\]+$/, "") + (WIN ? "\\" : "/") + createName.trim();
    const res  = await fetch("/api/fs/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, type: creating }),
    });
    const d = await res.json();
    if (d.error) { setError(d.error); }
    else { flash(`Created ${creating}.`); browse(listing.path); }
    setCreating(null);
    setCreateName("");
  };

  // ── Editor ─────────────────────────────────────────────────────────────────

  const openEditor = async (item: FsEntry) => {
    if (item.isDir) return;
    setEditLoading(true);
    setEditPath(item.path);
    setEditContent("");
    setEditDirty(false);
    try {
      const res  = await fetch(`/api/fs/content?path=${encodeURIComponent(item.path)}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setEditContent(data.content);
    } catch (e: any) { setError(e.message); setEditPath(null); }
    finally { setEditLoading(false); }
  };

  const saveEditor = async () => {
    if (!editPath) return;
    setEditSaving(true);
    try {
      const res  = await fetch("/api/fs/content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: editPath, content: editContent }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setEditDirty(false);
      flash("Saved.");
    } catch (e: any) { setError(e.message); }
    finally { setEditSaving(false); }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#0d1117] text-zinc-200 font-mono flex flex-col">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-[#0d1117]/95 backdrop-blur border-b border-zinc-800 px-4 py-3 space-y-2">
        <div className="flex items-center gap-x-2">
          <FolderOpen className="h-5 w-5 text-yellow-400 shrink-0" />

          {/* Breadcrumb */}
          {listing && (
            <div className="flex items-center gap-x-1 text-xs flex-1 overflow-x-auto min-w-0">
              {listing.crumbs.map((c, i) => (
                <React.Fragment key={c.path}>
                  {i > 0 && <ChevronRight className="h-3 w-3 text-zinc-700 shrink-0" />}
                  <button
                    onClick={() => browse(c.path)}
                    className={i === listing.crumbs.length - 1
                      ? "text-white truncate"
                      : "text-zinc-500 hover:text-white shrink-0 transition"}
                  >
                    {c.name}
                  </button>
                </React.Fragment>
              ))}
            </div>
          )}

          {/* Up button */}
          {listing && (
            <button onClick={() => browse(parentOf(listing.path))}
              className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-white transition shrink-0">
              <ChevronUp className="h-4 w-4" />
            </button>
          )}
          <button onClick={() => listing && browse(listing.path)}
            className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-white transition shrink-0">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-x-1 flex-wrap">
          <button onClick={() => { setCreating("file"); setCreateName(""); }}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-white transition">
            <FilePlus className="h-3.5 w-3.5" /> New File
          </button>
          <button onClick={() => { setCreating("dir"); setCreateName(""); }}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-white transition">
            <FolderPlus className="h-3.5 w-3.5" /> New Folder
          </button>
          <div className="h-4 w-px bg-zinc-800 mx-1" />
          <button onClick={copy} disabled={selected.size === 0}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:opacity-30 transition">
            <Copy className="h-3.5 w-3.5" /> Copy
          </button>
          <button onClick={cut} disabled={selected.size === 0}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:opacity-30 transition">
            <Scissors className="h-3.5 w-3.5" /> Cut
          </button>
          <button onClick={paste} disabled={!clip}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] transition disabled:opacity-30
              ${clip ? "text-indigo-400 hover:bg-indigo-500/20" : "text-zinc-400 hover:bg-zinc-800 hover:text-white"}`}>
            <Clipboard className="h-3.5 w-3.5" /> Paste{clip ? ` (${clip.paths.length})` : ""}
          </button>
          <div className="h-4 w-px bg-zinc-800 mx-1" />
          <button onClick={deleteSelected} disabled={selected.size === 0}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] text-zinc-400 hover:bg-rose-500/20 hover:text-rose-400 disabled:opacity-30 transition">
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
          {selected.size > 0 && (
            <span className="ml-2 text-[10px] text-zinc-600">{selected.size} selected</span>
          )}
          {clip && (
            <span className="ml-auto text-[10px] text-indigo-400">
              {clip.action === "copy" ? "📋" : "✂️"} {clip.paths.length} in clipboard
              <button onClick={() => setClip(null)} className="ml-1 text-zinc-600 hover:text-zinc-400">×</button>
            </span>
          )}
        </div>
      </div>

      {/* ── Toast ──────────────────────────────────────────────────────────── */}
      {toast && (
        <div className="mx-4 mt-3 flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-2 text-emerald-400 text-xs">
          <Check className="h-3.5 w-3.5" /> {toast}
        </div>
      )}
      {error && (
        <div className="mx-4 mt-3 flex items-center gap-2 bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-2 text-rose-400 text-xs">
          <AlertCircle className="h-3.5 w-3.5" /> {error}
          <button onClick={() => setError(null)} className="ml-auto text-zinc-600 hover:text-zinc-400">×</button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">

        {/* ── File listing ─────────────────────────────────────────────────── */}
        <div className={`flex flex-col ${editPath ? "w-1/2 border-r border-zinc-800" : "w-full"} overflow-y-auto`}>
          {loading ? (
            <div className="flex items-center justify-center py-20 text-zinc-500">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
            </div>
          ) : (
            <div className="px-4 py-3">

              {/* Create inline form */}
              {creating && (
                <div className="mb-2 flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/30 rounded-lg px-3 py-2">
                  {creating === "dir"
                    ? <FolderPlus className="h-4 w-4 text-indigo-400" />
                    : <FilePlus   className="h-4 w-4 text-indigo-400" />}
                  <input
                    autoFocus
                    value={createName}
                    onChange={e => setCreateName(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") commitCreate(); if (e.key === "Escape") setCreating(null); }}
                    placeholder={creating === "dir" ? "folder-name" : "file.txt"}
                    className="flex-1 bg-transparent text-sm text-white focus:outline-none"
                  />
                  <button onClick={commitCreate} className="p-1 hover:text-emerald-400 text-zinc-500 transition"><Check className="h-4 w-4" /></button>
                  <button onClick={() => setCreating(null)} className="p-1 hover:text-rose-400 text-zinc-500 transition"><X className="h-4 w-4" /></button>
                </div>
              )}

              {/* Items */}
              <div className="space-y-px">
                {listing?.items.map(item => (
                  <div
                    key={item.path}
                    className={`group flex items-center gap-x-3 px-2 py-2 rounded-lg transition cursor-pointer
                      ${selected.has(item.path) ? "bg-indigo-600/20 border border-indigo-500/30" : "hover:bg-zinc-800/60 border border-transparent"}`}
                    onClick={() => toggleSelect(item.path)}
                    onDoubleClick={() => item.isDir ? browse(item.path) : openEditor(item)}
                  >
                    <FileIcon group={item.mimeGroup} />

                    {/* Name — inline rename */}
                    {renaming === item.path ? (
                      <input
                        autoFocus
                        value={renameVal}
                        onChange={e => setRenameVal(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenaming(null); }}
                        onClick={e => e.stopPropagation()}
                        className="flex-1 bg-zinc-900 border border-indigo-500 rounded px-2 py-0.5 text-sm text-white focus:outline-none"
                      />
                    ) : (
                      <span className="flex-1 text-sm text-zinc-200 truncate select-none">{item.name}</span>
                    )}

                    <span className="text-[10px] text-zinc-600 shrink-0 hidden group-hover:block">
                      {item.isDir ? "folder" : item.sizeHuman}
                    </span>

                    {/* Row actions */}
                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition shrink-0"
                      onClick={e => e.stopPropagation()}>
                      {!item.isDir && (
                        <button onClick={() => openEditor(item)}
                          className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-indigo-400 transition" title="Edit">
                          <Pencil className="h-3 w-3" />
                        </button>
                      )}
                      <button onClick={() => startRename(item)}
                        className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-yellow-400 transition" title="Rename">
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button onClick={() => { setSelected(new Set([item.path])); setClip({ action: "copy", paths: [item.path] }); flash("Copied 1 item"); }}
                        className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-emerald-400 transition" title="Copy">
                        <Copy className="h-3 w-3" />
                      </button>
                      <button onClick={() => { setSelected(new Set([item.path])); setClip({ action: "cut", paths: [item.path] }); flash("Cut 1 item"); }}
                        className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-orange-400 transition" title="Cut">
                        <Scissors className="h-3 w-3" />
                      </button>
                      <button onClick={async () => {
                        if (!confirm(`Delete "${item.name}"?`)) return;
                        const r = await fetch(`/api/fs?path=${encodeURIComponent(item.path)}`, { method: "DELETE" });
                        const d = await r.json();
                        if (d.error) setError(d.error);
                        else { flash("Deleted."); listing && browse(listing.path); }
                      }} className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-rose-400 transition" title="Delete">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}

                {listing?.items.length === 0 && !creating && (
                  <div className="py-16 text-center text-zinc-600 text-sm">
                    <Folder className="h-12 w-12 opacity-20 mx-auto mb-3" />
                    Empty directory
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Text Editor panel ─────────────────────────────────────────────── */}
        {editPath && (
          <div className="flex flex-col w-1/2 overflow-hidden">
            {/* Editor header */}
            <div className="flex items-center gap-x-2 px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/60">
              <FileText className="h-4 w-4 text-zinc-500 shrink-0" />
              <span className="text-xs text-zinc-400 truncate flex-1">{editPath}</span>
              {editDirty && <span className="text-[10px] text-yellow-400 shrink-0">● unsaved</span>}
              <button onClick={saveEditor} disabled={!editDirty || editSaving}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-xs text-white transition shrink-0">
                {editSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
              </button>
              <button onClick={() => { if (!editDirty || confirm("Discard unsaved changes?")) { setEditPath(null); setEditDirty(false); } }}
                className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-white transition shrink-0">
                <X className="h-4 w-4" />
              </button>
            </div>
            {editLoading ? (
              <div className="flex items-center justify-center flex-1 text-zinc-500">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
              </div>
            ) : (
              <textarea
                value={editContent}
                onChange={e => { setEditContent(e.target.value); setEditDirty(true); }}
                spellCheck={false}
                className="flex-1 bg-[#0d1117] text-zinc-200 text-xs font-mono p-4 resize-none focus:outline-none leading-5"
              />
            )}
            {/* Footer with Ctrl+S hint */}
            <div className="border-t border-zinc-800 px-4 py-1.5 text-[10px] text-zinc-700 flex justify-between">
              <span>{editContent.split("\n").length} lines · {editContent.length} chars</span>
              <span>click Save or Ctrl+S</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
