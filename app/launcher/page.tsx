"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronRight,
  Loader2,
  Monitor,
  RefreshCw,
  Network,
  Cpu,
  Send,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface Peer {
  name: string;
  host: string;
  address?: string;
  macAddress?: string;
  trustStatus?: string;
  source: "mdns" | "static";
  online: boolean;
}

interface LauncherResponse {
  self: { hostname: string };
  peers: Peer[];
  lanReady?: boolean;
}

export default function LauncherPage() {
  const [peers, setPeers]         = useState<Peer[]>([]);
  const [selfName, setSelfName]   = useState<string>("THIS DEVICE");
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefresh]  = useState(false);
  const [manualIp, setManualIp]   = useState("");
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState("");

  // Pairing Handshake states
  const [pairingPeer, setPairingPeer] = useState<any>(null);
  const [pairingStatus, setPairingStatus] = useState<string>("");
  const [pairingError, setPairingError] = useState<string>("");
  const [pairingRequestId, setPairingRequestId] = useState<string>("");

  const router = useRouter();

  const fetchPeers = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefresh(true);
    try {
      const res  = await fetch("/api/peers", { cache: "no-store" });
      const data = (await res.json()) as LauncherResponse;
      
      if (data.lanReady === false && (!data.peers || data.peers.length === 0)) {
        router.push("/");
        return;
      }
      
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

  // Poll the durable SQLite request row while waiting for the remote user.
  useEffect(() => {
    if (!pairingRequestId) return;
    let timer: any;
    const poll = async () => {
      try {
        const res = await fetch(`/api/peers/requests?requestId=${pairingRequestId}`, { cache: "no-store" });
        if (!res.ok) return;
        const [request] = await res.json();
        if (!request) return;

        if (request.status === "ACCEPTED") {
          setPairingStatus("Trusted peer relationship established. Routing...");
          clearInterval(timer);
          setTimeout(() => router.push("/"), 1500);
        } else if (request.status === "DECLINED") {
          setPairingError("Connection was declined by the peer.");
          clearInterval(timer);
        } else if (request.status === "IGNORED") {
          setPairingError("Connection request was ignored by the peer.");
          clearInterval(timer);
        } else if (request.status === "BLOCKED") {
          setPairingError("Connection request was blocked by the peer.");
          clearInterval(timer);
        }
      } catch (err) {
        // ignore fetch errors during polling
      }
    };
    poll();
    timer = setInterval(poll, 2500);
    return () => clearInterval(timer);
  }, [pairingRequestId, router]);

  const useThisDevice = () => {
    router.push("/");
  };

  const connectToPeer = async (peer: Peer) => {
    const host = peer.host || peer.address || "";
    if (!host) return;

    setPairingError("");
    setPairingPeer({
      name: peer.name,
      host: host,
      macAddress: peer.macAddress || ""
    });
    setPairingStatus("Initiating secure P2P handshake...");

    try {
      const res = await fetch("/api/peers/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          macAddress: peer.macAddress,
          ipAddress: host
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Handshake request rejected by peer or daemon.");
      }

      const body = await res.json();
      setPairingRequestId(body.requestId);
      setPairingStatus("Handshake request sent! Waiting for acceptance...");
    } catch (err: any) {
      console.error(err);
      setPairingError(err.message || "Failed to establish connection.");
    }
  };

  const connectToManualIp = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const ipAddress = manualIp.trim();
    if (!ipAddress || manualBusy) return;

    setManualBusy(true);
    setManualError("");
    setPairingError("");
    setPairingPeer({
      name: "Manual peer",
      host: ipAddress,
      macAddress: ""
    });
    setPairingStatus("Sending secure request to static IP...");

    try {
      const res = await fetch("/api/peers/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ipAddress })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Could not reach that peer IP.");
      }

      const body = await res.json();
      setPairingRequestId(body.requestId);
      setPairingStatus("Request sent. Waiting for the peer to accept...");
    } catch (err: any) {
      const message = err.message || "Could not reach that peer IP.";
      setManualError(message);
      setPairingError(message);
    } finally {
      setManualBusy(false);
    }
  };

  return (
    <div className="touch-scroll h-screen bg-[#0a0e14] text-zinc-100 flex flex-col items-center justify-start py-5 sm:py-8 px-4 sm:px-6 font-mono overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: "touch" }}>
      <div className="max-w-2xl w-full space-y-5 sm:space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl sm:text-4xl uppercase tracking-[0.3em] font-black bg-gradient-to-r from-zinc-100 via-indigo-200 to-zinc-100 bg-clip-text text-transparent">CyberDeck</h1>
          <p className="text-zinc-500 text-xs uppercase tracking-widest">
            Air-gapped LAN messenger
          </p>
        </div>

        <motion.button
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          onClick={useThisDevice}
          className="w-full p-4 sm:p-6 rounded-2xl bg-indigo-600 hover:bg-indigo-500 transition flex items-center justify-between group shadow-lg shadow-indigo-900/30"
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

        <form
          onSubmit={connectToManualIp}
          className="rounded-2xl border border-zinc-800 bg-zinc-950/50 p-4 sm:p-5 space-y-3"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xs uppercase text-zinc-500 tracking-widest">
                Direct peer IP
              </h2>
              <p className="text-xs text-zinc-600 normal-case tracking-normal mt-1">
                Static LAN request
              </p>
            </div>
            <Network className="h-5 w-5 text-indigo-300" />
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={manualIp}
              onChange={(event) => {
                setManualIp(event.target.value);
                if (manualError) setManualError("");
              }}
              disabled={manualBusy}
              inputMode="decimal"
              placeholder="10.0.0.2"
              className="min-w-0 flex-1 rounded-xl border border-zinc-800 bg-zinc-900/70 px-4 py-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-indigo-500/70"
            />
            <button
              type="submit"
              disabled={manualBusy || manualIp.trim().length === 0}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-100 px-4 py-3 text-sm font-bold uppercase tracking-wider text-zinc-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {manualBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Connect
            </button>
          </div>
          {manualError && (
            <p className="text-xs text-rose-400 normal-case tracking-normal">
              {manualError}
            </p>
          )}
        </form>

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
                    disabled={peer.trustStatus === "TRUSTED" || peer.trustStatus === "BLOCKED"}
                    className="w-full p-4 rounded-xl bg-zinc-900/60 hover:bg-zinc-800/80 border border-zinc-800 hover:border-zinc-700 transition flex items-center justify-between group"
                  >
                    <div className="flex items-center gap-4">
                      <div
                        className={`h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-lg shadow-emerald-400/50 animate-pulse`}
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
                          {peer.trustStatus ? ` · ${peer.trustStatus.toLowerCase()}` : ""}
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
          signed UDP discovery · signed TCP handshake · no internet
        </div>
      </div>

      {/* Connection Handshake Overlay */}
      <AnimatePresence>
        {pairingPeer && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-[#0a0e14]/90 backdrop-blur-md flex items-center justify-center p-6 font-mono"
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              className="max-w-md w-full border border-indigo-500/20 bg-zinc-950/80 backdrop-blur-xl rounded-2xl p-8 flex flex-col items-center text-center shadow-[0_0_50px_rgba(99,102,241,0.15)] relative overflow-hidden"
            >
              <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-indigo-500 to-transparent animate-pulse" />

              <div className="relative mb-6 flex items-center justify-center h-20 w-20 rounded-full border border-indigo-500/30 bg-indigo-950/30 shadow-[0_0_20px_rgba(99,102,241,0.2)]">
                <Loader2 className="h-10 w-10 text-indigo-400 animate-spin" />
              </div>

              <div className="text-[10px] text-indigo-400 font-bold uppercase tracking-[0.3em] mb-2 flex items-center gap-1">
                <Cpu className="h-3.5 w-3.5 animate-pulse" /> Handshake Active
              </div>
              <h3 className="text-xl font-bold uppercase tracking-wider text-zinc-100">
                Pairing with {pairingPeer.name}
              </h3>
              <p className="text-xs text-zinc-500 mt-1">
                Address: {pairingPeer.host}
              </p>

              <div className="w-full mt-6 py-3 px-4 rounded-xl border border-zinc-900 bg-zinc-900/40 text-xs font-mono text-zinc-300 min-h-[50px] flex items-center justify-center">
                {pairingError ? (
                  <span className="text-rose-400 font-bold uppercase tracking-wider">{pairingError}</span>
                ) : (
                  <span>{pairingStatus}</span>
                )}
              </div>

              <button
                onClick={() => setPairingPeer(null)}
                className="mt-8 px-6 py-2.5 rounded-xl border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 uppercase tracking-widest text-[10px] font-bold transition-all w-full font-mono"
              >
                Cancel Connection
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
