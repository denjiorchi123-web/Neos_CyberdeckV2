"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Network, RefreshCw, Loader2, AlertCircle, CheckCircle2,
  Pencil, Trash2, Plus, Save, X, Wifi, Globe, Server,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface NetInterface {
  name:     string;
  mac?:     string;
  ip?:      string;
  prefix?:  number;
  gateway?: string;
  up:       boolean;
  loopback: boolean;
}

interface StaticPeer {
  name:     string;
  host:     string;
  address?: string;
}

type Tab = "interfaces" | "peers" | "hostname";

// ── Helpers ───────────────────────────────────────────────────────────────────

function Badge({ up }: { up: boolean }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${
      up ? "bg-emerald-500/20 text-emerald-400" : "bg-zinc-700 text-zinc-500"
    }`}>
      {up ? "UP" : "DOWN"}
    </span>
  );
}

function IfaceIcon({ name }: { name: string }) {
  const n = name.toLowerCase();
  if (n.includes("bat")) return <Network  className="h-4 w-4 text-indigo-400" />;
  if (n.includes("usb")) return <Wifi     className="h-4 w-4 text-emerald-400" />;
  return                         <Globe   className="h-4 w-4 text-zinc-400" />;
}

// ── IP Edit Inline Form ───────────────────────────────────────────────────────

function IpEditForm({
  iface, initialIp, initialPrefix, initialGateway,
  onSave, onCancel,
}: {
  iface: string; initialIp?: string; initialPrefix?: number; initialGateway?: string;
  onSave: (ip: string, prefix: number, gateway: string) => void;
  onCancel: () => void;
}) {
  const [ip,      setIp]      = useState(initialIp      ?? "");
  const [prefix,  setPrefix]  = useState(String(initialPrefix ?? 24));
  const [gateway, setGateway] = useState(initialGateway ?? "");

  return (
    <div className="mt-3 pt-3 border-t border-zinc-800 flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2">
          <label className="text-[10px] text-zinc-500 uppercase tracking-widest block mb-1">IP Address</label>
          <input
            value={ip} onChange={e => setIp(e.target.value)}
            placeholder="10.0.0.1"
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div>
          <label className="text-[10px] text-zinc-500 uppercase tracking-widest block mb-1">Prefix /</label>
          <input
            value={prefix} onChange={e => setPrefix(e.target.value)}
            placeholder="24" type="number" min={1} max={32}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>
      <div>
        <label className="text-[10px] text-zinc-500 uppercase tracking-widest block mb-1">Gateway (optional)</label>
        <input
          value={gateway} onChange={e => setGateway(e.target.value)}
          placeholder="10.0.0.254"
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-indigo-500"
        />
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:bg-zinc-800 transition">
          <X className="h-3.5 w-3.5" /> Cancel
        </button>
        <button
          onClick={() => onSave(ip, parseInt(prefix), gateway)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs text-white transition"
        >
          <Save className="h-3.5 w-3.5" /> Apply
        </button>
      </div>
    </div>
  );
}

// ── Peer Row ──────────────────────────────────────────────────────────────────

function PeerRow({
  peer, onDelete, onSave,
}: {
  peer: StaticPeer;
  onDelete: (host: string) => void;
  onSave: (peer: StaticPeer) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name,    setName]    = useState(peer.name);
  const [address, setAddress] = useState(peer.address ?? "");

  return (
    <div className="px-4 py-3 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-2">
      <div className="flex items-center justify-between gap-x-3">
        <div className="flex items-center gap-x-3 min-w-0">
          <Server className="h-4 w-4 text-zinc-500 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm text-white font-mono truncate">{peer.name}</p>
            <p className="text-[11px] text-zinc-500 font-mono">
              {peer.host}{peer.address ? ` · ${peer.address}` : ""}
            </p>
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          <button onClick={() => setEditing(v => !v)}
            className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-indigo-400 transition">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => onDelete(peer.host)}
            className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-rose-400 transition">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {editing && (
        <div className="pt-2 border-t border-zinc-800 flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-zinc-500 uppercase tracking-widest block mb-1">Display Name</label>
              <input value={name} onChange={e => setName(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="text-[10px] text-zinc-500 uppercase tracking-widest block mb-1">Static IP</label>
              <input value={address} onChange={e => setAddress(e.target.value)}
                placeholder="10.0.0.x"
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-indigo-500" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditing(false)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:bg-zinc-800 transition">
              <X className="h-3.5 w-3.5" /> Cancel
            </button>
            <button onClick={() => { onSave({ ...peer, name, address: address || undefined }); setEditing(false); }}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs text-white transition">
              <Save className="h-3.5 w-3.5" /> Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function NetworkPage() {
  const [tab,        setTab]        = useState<Tab>("interfaces");
  const [ifaces,     setIfaces]     = useState<NetInterface[]>([]);
  const [hostname,   setHostname]   = useState("");
  const [peers,      setPeers]      = useState<StaticPeer[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [editingIf,  setEditingIf]  = useState<string | null>(null);
  const [msg,        setMsg]        = useState<{ ok: boolean; text: string } | null>(null);

  // Hostname edit state
  const [newHostname, setNewHostname] = useState("");

  // Add-peer form state
  const [addOpen,    setAddOpen]    = useState(false);
  const [newName,    setNewName]    = useState("");
  const [newHost,    setNewHost]    = useState("");
  const [newAddress, setNewAddress] = useState("");

  // ── Loaders ──────────────────────────────────────────────────────────────────

  const loadInterfaces = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch("/api/network");
      const data = await res.json();
      setIfaces(data.interfaces ?? []);
      setHostname(data.hostname ?? "");
      setNewHostname(data.hostname ?? "");
    } catch { /* quiet */ }
    finally { setLoading(false); }
  }, []);

  const loadPeers = useCallback(async () => {
    try {
      const res  = await fetch("/api/network/peers");
      const data = await res.json();
      setPeers(data.peers ?? []);
    } catch { /* quiet */ }
  }, []);

  useEffect(() => {
    loadInterfaces();
    loadPeers();
  }, [loadInterfaces, loadPeers]);

  // ── Actions ───────────────────────────────────────────────────────────────────

  function flash(ok: boolean, text: string) {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), 4000);
  }

  const applyIp = async (iface: string, ip: string, prefix: number, gateway: string) => {
    setSaving(true);
    setEditingIf(null);
    try {
      const res  = await fetch("/api/network/set-ip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ iface, ip, prefix, gateway: gateway || undefined }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      flash(true, `${iface} set to ${ip}/${prefix}`);
      setTimeout(loadInterfaces, 1500);
    } catch (e: any) {
      flash(false, e.message);
    } finally { setSaving(false); }
  };

  const applyHostname = async () => {
    setSaving(true);
    try {
      const res  = await fetch("/api/network/hostname", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostname: newHostname }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setHostname(newHostname);
      flash(true, `Hostname changed to ${newHostname}. Effective after reboot.`);
    } catch (e: any) {
      flash(false, e.message);
    } finally { setSaving(false); }
  };

  const addPeer = async () => {
    if (!newHost.trim()) return;
    try {
      const res  = await fetch("/api/network/peers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName || newHost, host: newHost, address: newAddress || undefined }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setNewName(""); setNewHost(""); setNewAddress(""); setAddOpen(false);
      flash(true, `Peer ${newHost} added.`);
      loadPeers();
    } catch (e: any) {
      flash(false, e.message);
    }
  };

  const deletePeer = async (host: string) => {
    try {
      const res = await fetch(`/api/network/peers?host=${encodeURIComponent(host)}`, { method: "DELETE" });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      flash(true, `Peer ${host} removed.`);
      loadPeers();
    } catch (e: any) { flash(false, e.message); }
  };

  const savePeer = async (peer: StaticPeer) => {
    try {
      const res  = await fetch("/api/network/peers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(peer),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      flash(true, `Peer ${peer.host} updated.`);
      loadPeers();
    } catch (e: any) { flash(false, e.message); }
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#0d1117] text-zinc-200 font-mono">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#0d1117]/95 backdrop-blur border-b border-zinc-800 px-6 py-4 flex items-center gap-x-3">
        <Network className="h-5 w-5 text-indigo-400" />
        <span className="text-sm text-zinc-400 uppercase tracking-widest flex-1">Network Settings</span>
        <button onClick={() => { loadInterfaces(); loadPeers(); }}
          className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-white transition">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-6">
        {/* Toast */}
        {msg && (
          <div className={`mb-4 flex items-center gap-x-2 rounded-xl px-4 py-3 text-sm border ${
            msg.ok
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
              : "bg-rose-500/10 border-rose-500/30 text-rose-400"
          }`}>
            {msg.ok
              ? <CheckCircle2 className="h-4 w-4 shrink-0" />
              : <AlertCircle  className="h-4 w-4 shrink-0" />}
            {msg.text}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-zinc-900/60 p-1 rounded-xl border border-zinc-800">
          {(["interfaces", "peers", "hostname"] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-2 rounded-lg text-xs uppercase tracking-widest transition ${
                tab === t
                  ? "bg-indigo-600 text-white"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}>
              {t}
            </button>
          ))}
        </div>

        {/* ── Interfaces tab ─────────────────────────────────────────────────── */}
        {tab === "interfaces" && (
          <>
            {loading ? (
              <div className="flex items-center justify-center py-20 text-zinc-500">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Scanning interfaces…
              </div>
            ) : (
              <div className="space-y-3">
                {ifaces.filter(i => !i.loopback).map(iface => (
                  <div key={iface.name}
                    className="bg-zinc-900/60 border border-zinc-800 rounded-2xl px-5 py-4">
                    <div className="flex items-center justify-between gap-x-3">
                      <div className="flex items-center gap-x-3 min-w-0">
                        <IfaceIcon name={iface.name} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-x-2">
                            <span className="text-sm font-bold text-white">{iface.name}</span>
                            <Badge up={iface.up} />
                          </div>
                          <p className="text-[11px] text-zinc-500 mt-0.5 font-mono">
                            {iface.ip
                              ? <>{iface.ip}/{iface.prefix ?? "?"}{iface.gateway ? ` · gw ${iface.gateway}` : ""}</>
                              : "No IP assigned"}
                          </p>
                          {iface.mac && (
                            <p className="text-[10px] text-zinc-700 mt-0.5 font-mono">{iface.mac}</p>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => setEditingIf(editingIf === iface.name ? null : iface.name)}
                        disabled={saving}
                        className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-indigo-400 transition shrink-0"
                        title="Change IP"
                      >
                        {saving && editingIf === iface.name
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <Pencil  className="h-4 w-4" />}
                      </button>
                    </div>

                    {editingIf === iface.name && (
                      <IpEditForm
                        iface={iface.name}
                        initialIp={iface.ip}
                        initialPrefix={iface.prefix}
                        initialGateway={iface.gateway}
                        onSave={(ip, prefix, gw) => applyIp(iface.name, ip, prefix, gw)}
                        onCancel={() => setEditingIf(null)}
                      />
                    )}
                  </div>
                ))}

                {/* loopback — read only, collapsed */}
                {ifaces.filter(i => i.loopback).map(iface => (
                  <div key={iface.name}
                    className="bg-zinc-900/30 border border-zinc-800/50 rounded-xl px-4 py-2.5 flex items-center gap-x-3">
                    <span className="text-xs text-zinc-600 font-mono">{iface.name}</span>
                    <span className="text-xs text-zinc-700 font-mono">{iface.ip ?? "127.0.0.1"}</span>
                    <span className="ml-auto text-[10px] text-zinc-700 uppercase">loopback</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── Peers tab ──────────────────────────────────────────────────────── */}
        {tab === "peers" && (
          <div className="space-y-3">
            <p className="text-xs text-zinc-600 leading-relaxed">
              Static peers are used as fallback when mDNS is unavailable.
              These are saved to <span className="text-zinc-400">peers.json</span> and merged with live Avahi results in the launcher.
            </p>

            {peers.map(p => (
              <PeerRow key={p.host} peer={p} onDelete={deletePeer} onSave={savePeer} />
            ))}

            {peers.length === 0 && !addOpen && (
              <div className="text-center text-zinc-600 text-sm py-8">
                No static peers. Add one below.
              </div>
            )}

            {/* Add peer form */}
            {addOpen ? (
              <div className="bg-zinc-900/60 border border-indigo-500/30 rounded-xl px-4 py-4 space-y-3">
                <p className="text-xs text-zinc-400 uppercase tracking-widest">Add Peer</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-zinc-500 uppercase tracking-widest block mb-1">Display Name</label>
                    <input value={newName} onChange={e => setNewName(e.target.value)}
                      placeholder="DECK-05"
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-indigo-500" />
                  </div>
                  <div>
                    <label className="text-[10px] text-zinc-500 uppercase tracking-widest block mb-1">Hostname / mDNS *</label>
                    <input value={newHost} onChange={e => setNewHost(e.target.value)}
                      placeholder="deck-05.local"
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-indigo-500" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-zinc-500 uppercase tracking-widest block mb-1">Static IP (optional)</label>
                  <input value={newAddress} onChange={e => setNewAddress(e.target.value)}
                    placeholder="10.0.0.5"
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-indigo-500" />
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setAddOpen(false)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:bg-zinc-800 transition">
                    <X className="h-3.5 w-3.5" /> Cancel
                  </button>
                  <button onClick={addPeer} disabled={!newHost.trim()}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-xs text-white transition">
                    <Plus className="h-3.5 w-3.5" /> Add Peer
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setAddOpen(true)}
                className="w-full py-3 rounded-xl border border-dashed border-zinc-700 text-zinc-500 hover:text-indigo-400 hover:border-indigo-500/50 transition text-sm flex items-center justify-center gap-2">
                <Plus className="h-4 w-4" /> Add Peer
              </button>
            )}
          </div>
        )}

        {/* ── Hostname tab ───────────────────────────────────────────────────── */}
        {tab === "hostname" && (
          <div className="space-y-6">
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl px-5 py-5 space-y-4">
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-widest mb-1">Current hostname</p>
                <p className="text-2xl font-bold text-white tracking-wide">{hostname || "—"}</p>
              </div>

              <div className="border-t border-zinc-800 pt-4 space-y-3">
                <p className="text-xs text-zinc-500 uppercase tracking-widest">Change hostname</p>
                <p className="text-xs text-zinc-600 leading-relaxed">
                  Letters, numbers and hyphens only. This Pi will be discoverable as{" "}
                  <span className="text-zinc-400">{newHostname || "..."}.local</span> via mDNS.
                  Takes effect after reboot.
                </p>
                <div className="flex gap-2">
                  <input
                    value={newHostname}
                    onChange={e => setNewHostname(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                    placeholder="deck-01"
                    className="flex-1 bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    onClick={applyHostname}
                    disabled={saving || !newHostname || newHostname === hostname}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-sm text-white transition"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Apply
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-zinc-900/30 border border-zinc-800/50 rounded-xl px-4 py-3">
              <p className="text-xs text-zinc-600 leading-relaxed">
                <span className="text-zinc-400">bat0</span> mesh IP is set via the Interfaces tab.
                The hostname controls mDNS (.local) discovery in the launcher.
                Set consistent names across all Pi nodes (deck-01 → deck-0N).
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
