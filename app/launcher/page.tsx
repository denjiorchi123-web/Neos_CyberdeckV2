"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  ChevronRight,
  Loader2,
  Monitor,
  RefreshCw,
  Network,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface Peer {
  name: string;
  host: string;
  address?: string;
  source: "mdns" | "static";
  online: boolean;
}

interface LauncherResponse {
  self: { hostname: string };
  peers: Peer[];
}

export default function LauncherPage() {
  const [peers, setPeers]         = useState<Peer[]>([]);
  const [selfName, setSelfName]   = useState<string>("THIS DEVICE");
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefresh]  = useState(false);

  const fetchPeers = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefresh(true);
    try {
      const res  = await fetch("/api/peers", { cache: "no-store" });
      const data = (await res.json()) as LauncherResponse;
      setPeers(data.peers || []);
      if (data.self?.hostname) setSelfName(data.self.hostname.toUpperCase());
    } catch {
      // Quietly swallow — empty list is the right UX
    } finally {
      setLoading(false);
      setRefresh(false);
    }
  }, []);

  useEffect(() => {
    fetchPeers();
    const t = setInterval(() => fetchPeers(false), 10000);
    return () => clearInterval(t);
  }, [fetchPeers]);

  const useThisDevice = () => {
    window.location.href = "/";
  };

  const connectToPeer = (peer: Peer) => {
    // Stay on the same protocol/port — every Pi runs the same stack.
    const proto = window.location.protocol;
    const port  = window.location.port ? `:${window.location.port}` : "";
    const host  = peer.host || peer.address || "";
    if (!host) return;
    window.location.href = `${proto}//${host}${port}/`;
  };

  return (
    <div className="min-h-screen bg-[#0a0e14] text-zinc-100 flex items-center justify-center p-6 font-mono">
      <div className="max-w-2xl w-full space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-4xl uppercase tracking-[0.3em]">CyberDeck</h1>
          <p className="text-zinc-500 text-xs uppercase tracking-widest">
            Air-gapped LAN messenger
          </p>
        </div>

        <motion.button
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          onClick={useThisDevice}
          className="w-full p-6 rounded-2xl bg-indigo-600 hover:bg-indigo-500 transition flex items-center justify-between group shadow-lg shadow-indigo-900/30"
        >
          <div className="flex items-center gap-4">
            <Monitor className="h-8 w-8" />
            <div className="text-left">
              <div className="text-lg uppercase tracking-wider">Use this device</div>
              <div className="text-xs text-indigo-200 opacity-80 normal-case tracking-normal">
                Host the session on {selfName}
              </div>
            </div>
          </div>
          <ChevronRight className="h-6 w-6 group-hover:translate-x-1 transition" />
        </motion.button>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs uppercase text-zinc-500 tracking-widest">
              Discovered peers
            </h2>
            <button
              onClick={() => fetchPeers(true)}
              disabled={refreshing}
              className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1 normal-case tracking-normal"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
              />
              Refresh
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center p-8 text-zinc-500 text-sm">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Scanning LAN…
            </div>
          ) : peers.length === 0 ? (
            <div className="p-8 rounded-2xl border border-zinc-800 text-center text-zinc-500 text-sm normal-case tracking-normal">
              <Network className="h-8 w-8 mx-auto mb-3 opacity-30" />
              No peers found. Check the LAN cable and confirm the other Pi is powered on.
            </div>
          ) : (
            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {peers.map((peer) => (
                  <motion.button
                    key={peer.host}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    whileHover={{ scale: 1.005 }}
                    onClick={() => connectToPeer(peer)}
                    className="w-full p-4 rounded-xl bg-zinc-900/60 hover:bg-zinc-800/80 border border-zinc-800 hover:border-zinc-700 transition flex items-center justify-between group"
                  >
                    <div className="flex items-center gap-4">
                      <div
                        className={`h-2.5 w-2.5 rounded-full ${
                          peer.source === "mdns"
                            ? "bg-emerald-400 shadow-lg shadow-emerald-400/50 animate-pulse"
                            : "bg-zinc-500"
                        }`}
                      />
                      <div className="text-left">
                        <div className="text-sm uppercase tracking-wider">{peer.name}</div>
                        <div className="text-xs text-zinc-500 normal-case tracking-normal">
                          {peer.host}
                          {peer.address && peer.address !== peer.host
                            ? ` · ${peer.address}`
                            : ""}
                          {" · "}
                          {peer.source === "mdns" ? "live" : "static"}
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-zinc-600 group-hover:text-zinc-300 group-hover:translate-x-1 transition" />
                  </motion.button>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>

        <div className="text-center text-[10px] text-zinc-700 uppercase tracking-[0.3em] pt-4">
          mDNS + static fallback · no internet
        </div>
      </div>
    </div>
  );
}
