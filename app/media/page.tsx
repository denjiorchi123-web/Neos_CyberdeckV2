"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Image as ImageIcon, Video, Music, FileText, Trash2, Share2,
  RefreshCw, Loader2, X, Check, ChevronDown, FolderOpen, ArrowLeft
} from "lucide-react";
import { FileViewer } from "@/components/file-viewer";

// ─── Types ────────────────────────────────────────────────────────────────────

type Category = "all" | "photos" | "videos" | "audio" | "documents";

interface MediaFile {
  id: string;
  name: string;
  filename: string;
  url: string;
  thumbnailUrl: string | null;
  size: number;
  mimeType: string;
  source: string;
  createdAt: string;
}

interface Channel { id: string; name: string; }
interface ServerOption { id: string; name: string; channels: Channel[]; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function humanSize(b: number) {
  if (b >= 1073741824) return `${(b / 1073741824).toFixed(1)} GB`;
  if (b >= 1048576)    return `${(b / 1048576).toFixed(1)} MB`;
  if (b >= 1024)       return `${Math.round(b / 1024)} KB`;
  return `${b} B`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// ─── Share modal ──────────────────────────────────────────────────────────────

function ShareModal({ file, onClose, onShared }: {
  file: MediaFile;
  onClose: () => void;
  onShared: () => void;
}) {
  const [servers,  setServers]  = useState<ServerOption[]>([]);
  const [serverId, setServerId] = useState("");
  const [chanId,   setChanId]   = useState("");
  const [sending,  setSending]  = useState(false);
  const [done,     setDone]     = useState(false);
  const [error,    setError]    = useState("");

  useEffect(() => {
    fetch("/api/media/share")
      .then(r => r.json())
      .then(d => {
        setServers(d.servers ?? []);
        if (d.servers?.[0]) {
          setServerId(d.servers[0].id);
          if (d.servers[0].channels?.[0]) setChanId(d.servers[0].channels[0].id);
        }
      })
      .catch(() => setError("Could not load channels."));
  }, []);

  const selectedServer = servers.find(s => s.id === serverId);

  const send = async () => {
    if (!chanId) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/media/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId: file.id, channelId: chanId }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setDone(true);
      setTimeout(() => { onShared(); onClose(); }, 1200);
    } catch (e: any) {
      setError(e.message);
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#1e1f22] border border-zinc-700 rounded-2xl w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-white font-bold text-sm">Share to channel</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-zinc-400 text-xs truncate">{file.name}</p>

        {error && <p className="text-rose-400 text-xs">{error}</p>}

        {done ? (
          <div className="flex items-center gap-x-2 text-emerald-400 text-sm">
            <Check className="h-4 w-4" /> Shared!
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <label className="text-[10px] text-zinc-500 uppercase tracking-widest">Server</label>
              <div className="relative">
                <select
                  value={serverId}
                  onChange={e => {
                    setServerId(e.target.value);
                    const s = servers.find(x => x.id === e.target.value);
                    setChanId(s?.channels[0]?.id ?? "");
                  }}
                  className="w-full bg-zinc-800 text-white text-sm rounded-xl px-3 py-2.5 appearance-none border border-zinc-700 focus:outline-none focus:border-indigo-500"
                >
                  {servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <ChevronDown className="absolute right-3 top-3 h-4 w-4 text-zinc-500 pointer-events-none" />
              </div>
            </div>

            {selectedServer && (
              <div className="space-y-2">
                <label className="text-[10px] text-zinc-500 uppercase tracking-widest">Channel</label>
                <div className="relative">
                  <select
                    value={chanId}
                    onChange={e => setChanId(e.target.value)}
                    className="w-full bg-zinc-800 text-white text-sm rounded-xl px-3 py-2.5 appearance-none border border-zinc-700 focus:outline-none focus:border-indigo-500"
                  >
                    {selectedServer.channels.map(c =>
                      <option key={c.id} value={c.id}>#{c.name}</option>
                    )}
                  </select>
                  <ChevronDown className="absolute right-3 top-3 h-4 w-4 text-zinc-500 pointer-events-none" />
                </div>
              </div>
            )}

            <button
              onClick={send}
              disabled={!chanId || sending}
              className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-bold flex items-center justify-center gap-x-2 transition"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
              Share
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const TABS: { id: Category; label: string; Icon: any }[] = [
  { id: "all",       label: "All",       Icon: FolderOpen },
  { id: "photos",    label: "Photos",    Icon: ImageIcon  },
  { id: "videos",    label: "Videos",    Icon: Video      },
  { id: "audio",     label: "Audio",     Icon: Music      },
  { id: "documents", label: "Docs",      Icon: FileText   },
];

export default function MediaPage() {
  const [category,   setCategory]   = useState<Category>("all");
  const [files,      setFiles]      = useState<MediaFile[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [deleting,   setDeleting]   = useState<string | null>(null);
  const [shareFile,  setShareFile]  = useState<MediaFile | null>(null);
  const [lightbox,   setLightbox]   = useState<MediaFile | null>(null);
  const [toast,      setToast]      = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const goBack = () => {
    if (window.history.length > 1) window.history.back();
    else window.location.href = "/";
  };

  const load = useCallback(async (cat: Category) => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/media?category=${cat}`);
      const data = await res.json();
      setFiles(data.files ?? []);
    } catch {
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(category); }, [category, load]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  const deleteFile = async (file: MediaFile) => {
    if (!confirm(`Delete "${file.name}"?`)) return;
    setDeleting(file.id);
    try {
      await fetch(`/api/media/${file.id}`, { method: "DELETE" });
      setFiles(f => f.filter(x => x.id !== file.id));
      showToast("File deleted.");
    } catch {
      showToast("Delete failed.");
    } finally {
      setDeleting(null);
    }
  };

  const isImage = (f: MediaFile) => f.mimeType.startsWith("image/");
  const isVideo = (f: MediaFile) => f.mimeType.startsWith("video/");
  const isAudio = (f: MediaFile) => f.mimeType.startsWith("audio/");

  return (
    <div className="h-full overflow-y-auto bg-[#0d1117] text-zinc-200 font-mono">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#0d1117]/95 backdrop-blur border-b border-zinc-800 px-6 py-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-x-4">
            <button onClick={goBack} className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition flex items-center gap-2 pr-3">
              <ArrowLeft className="h-4 w-4" />
              <span className="text-xs font-bold uppercase tracking-wider">Back</span>
            </button>
            <span className="text-sm text-zinc-400 uppercase tracking-widest">Media Library</span>
          </div>
          <button onClick={() => load(category)} className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-white">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
        {/* Category tabs */}
        <div className="touch-scroll-x flex gap-x-2 overflow-x-auto pb-2 scrollbar-hide">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setCategory(t.id)}
              className={`flex items-center gap-x-2 px-5 py-3 rounded-xl text-sm font-bold whitespace-nowrap transition ${
                category === t.id
                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/20"
                  : "text-zinc-400 hover:text-white hover:bg-zinc-800/80 active:bg-zinc-700"
              }`}
            >
              <t.Icon className="h-4 w-4" />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-zinc-500">
            <Loader2 className="h-6 w-6 animate-spin mr-3" /> Loading…
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-y-4 text-zinc-500">
            <FolderOpen className="h-16 w-16 opacity-20" />
            <p className="text-sm">No {category === "all" ? "files" : category} stored yet.</p>
            <p className="text-xs normal-case">Upload files via chat or copy from a USB drive.</p>
          </div>
        ) : category === "photos" ? (
          /* Photo grid */
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {files.map(f => (
              <div key={f.id} className="group relative aspect-square rounded-xl overflow-hidden bg-zinc-800/60 border border-zinc-800">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={f.thumbnailUrl ?? f.url}
                  alt={f.name}
                  className="w-full h-full object-cover cursor-pointer"
                  onClick={() => setLightbox(f)}
                  onError={e => { (e.target as HTMLImageElement).src = f.url; }}
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition flex items-end p-2">
                  <p className="text-white text-[10px] truncate flex-1">{f.name}</p>
                  <div className="flex gap-x-1 shrink-0">
                    <button onClick={() => setShareFile(f)} className="p-1 rounded bg-indigo-600 hover:bg-indigo-500">
                      <Share2 className="h-3 w-3 text-white" />
                    </button>
                    <button onClick={() => deleteFile(f)} disabled={deleting === f.id} className="p-1 rounded bg-rose-600 hover:bg-rose-500 disabled:opacity-40">
                      {deleting === f.id ? <Loader2 className="h-3 w-3 text-white animate-spin" /> : <Trash2 className="h-3 w-3 text-white" />}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* List view for videos, audio, documents, all */
          <div className="space-y-1">
            {files.map(f => (
              <div
                key={f.id}
                onClick={() => setLightbox(f)}
                className="flex items-center gap-x-3 px-3 py-3 rounded-xl hover:bg-zinc-800/60 group transition cursor-pointer"
              >
                {/* Thumbnail / icon */}
                <div className="h-12 w-12 rounded-lg overflow-hidden bg-zinc-800 shrink-0 flex items-center justify-center">
                  {isImage(f) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={f.thumbnailUrl ?? f.url} alt="" className="w-full h-full object-cover" />
                  ) : isVideo(f) ? (
                    <Video className="h-5 w-5 text-blue-400" />
                  ) : isAudio(f) ? (
                    <Music className="h-5 w-5 text-purple-400" />
                  ) : (
                    <FileText className="h-5 w-5 text-zinc-400" />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{f.name}</p>
                  <p className="text-[10px] text-zinc-500 mt-0.5">
                    {humanSize(f.size)} · {formatDate(f.createdAt)}
                    {f.source && f.source !== "dm" && (
                      <> · <span className="text-zinc-600">{f.source}</span></>
                    )}
                  </p>
                  {isAudio(f) && (
                    <audio src={f.url} controls className="mt-1 h-7 w-full max-w-xs" />
                  )}
                  {isVideo(f) && (
                    <div className="mt-1 flex flex-col gap-y-2">
                      <video
                        src={f.url}
                        controls
                        playsInline
                        preload="metadata"
                        className="rounded-lg max-h-32 max-w-xs bg-black"
                        style={{ touchAction: "manipulation" }}
                        onClick={(event) => event.stopPropagation()}
                      />
                      <button
                        type="button"
                        onClick={() => setLightbox(f)}
                        className="h-10 w-fit px-3 rounded-lg bg-blue-500/15 text-blue-300 text-xs font-semibold active:bg-blue-500/25"
                      >
                        Open video
                      </button>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-x-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition shrink-0">
                  <button onClick={(e) => { e.stopPropagation(); setShareFile(f); }} title="Share to channel"
                    className="p-3 rounded-xl bg-zinc-800/80 md:bg-transparent hover:bg-zinc-700 text-zinc-300 md:text-zinc-400 hover:text-indigo-400 transition active:scale-95">
                    <Share2 className="h-5 w-5" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); deleteFile(f); }} disabled={deleting === f.id} title="Delete"
                    className="p-3 rounded-xl bg-zinc-800/80 md:bg-transparent hover:bg-zinc-700 text-zinc-300 md:text-zinc-400 hover:text-rose-400 transition disabled:opacity-40 active:scale-95">
                    {deleting === f.id ? <Loader2 className="h-5 w-5 animate-spin" /> : <Trash2 className="h-5 w-5" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
          style={{ touchAction: "manipulation" }}
        >
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setLightbox(null);
            }}
            className="absolute left-4 top-4 z-10 flex h-12 items-center gap-2 rounded-full bg-white/10 px-4 text-sm font-bold text-white/90 active:bg-white/20"
            style={{ touchAction: "manipulation" }}
            aria-label="Back to media list"
          >
            <ArrowLeft className="h-5 w-5" />
            Back
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setLightbox(null);
            }}
            className="absolute top-4 right-4 h-12 w-12 rounded-full bg-white/10 flex items-center justify-center text-white/80 hover:text-white active:bg-white/20"
            style={{ touchAction: "manipulation" }}
            aria-label="Close preview"
          >
            <X className="h-6 w-6" />
          </button>
          {isVideo(lightbox) ? (
            <video
              src={lightbox.url}
              controls
              autoPlay
              playsInline
              preload="metadata"
              className="max-w-full max-h-full rounded-xl shadow-2xl bg-black"
              onClick={e => e.stopPropagation()}
              style={{ touchAction: "manipulation" }}
            />
          ) : isAudio(lightbox) ? (
            <div
              className="w-full max-w-lg rounded-2xl bg-zinc-950 border border-white/10 p-6 shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <p className="text-white text-sm font-semibold mb-4 truncate">{lightbox.name}</p>
              <audio src={lightbox.url} controls autoPlay className="w-full" />
            </div>
          ) : lightbox.mimeType === "application/pdf" ? (
             <iframe
               src={lightbox.url.replace(/^https?:\/\/[^\/]+/, '')}
               className="w-full h-full max-w-6xl max-h-[85vh] rounded-xl shadow-2xl bg-white"
               onClick={e => e.stopPropagation()}
             />
          ) : !isImage(lightbox) ? (
             <div className="w-full h-full max-w-6xl max-h-[85vh] p-4 flex items-center justify-center" onClick={e => e.stopPropagation()}>
               <FileViewer url={lightbox.url.replace(/^https?:\/\/[^\/]+/, '')} name={lightbox.name} mimeType={lightbox.mimeType} />
             </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={lightbox.url}
              alt={lightbox.name}
              className="max-w-full max-h-full rounded-xl shadow-2xl"
              onClick={e => e.stopPropagation()}
            />
          )}
          <div className="absolute bottom-4 left-0 right-0 text-center text-white/60 text-xs">
            {lightbox.name} · {humanSize(lightbox.size)}
          </div>
        </div>
      )}

      {/* Share modal */}
      {shareFile && (
        <ShareModal
          file={shareFile}
          onClose={() => setShareFile(null)}
          onShared={() => showToast(`Shared "${shareFile.name}" to channel.`)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-white shadow-xl z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
