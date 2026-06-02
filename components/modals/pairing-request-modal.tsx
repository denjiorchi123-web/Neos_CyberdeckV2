"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Network, ShieldAlert, Cpu, Sparkles, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useModal } from "@/hooks/use-modal-store";
import { Button } from "@/components/ui/button";

export function PairingRequestModal() {
  const { isOpen, onClose, type, data } = useModal();
  const router = useRouter();

  const isModalOpen = isOpen && type === "pairingRequest";
  const { query } = data;

  const requestId = query?.requestId || "";
  const peerMac = query?.fromNodeId || "";
  const peerHostname = query?.hostname || peerMac || "Unknown Peer";
  const peerIp = query?.ipAddress || "";

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const respond = async (action: "ACCEPTED" | "DECLINED" | "IGNORED" | "BLOCKED") => {
    try {
      setIsLoading(true);
      setError("");

      const res = await fetch("/api/peers/pair/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, action })
      });

      if (!res.ok) {
        throw new Error("Failed to answer pairing request");
      }

      onClose();
      router.refresh();
    } catch (err: any) {
      console.error(err);
      setError("Failed to update the trusted-peer relationship.");
    } finally {
      setIsLoading(false);
    }
  };

  const onAccept = () => respond("ACCEPTED");
  const onDecline = () => respond("DECLINED");
  const onIgnore = () => respond("IGNORED");
  const onBlock = () => respond("BLOCKED");

  return (
    <Dialog open={isModalOpen} onOpenChange={onClose}>
      <DialogContent className="border border-indigo-500/20 bg-zinc-955/90 backdrop-blur-xl text-white overflow-hidden max-w-md shadow-[0_0_50px_rgba(99,102,241,0.15)] rounded-2xl p-0 font-mono">
        <div className="relative p-6 pt-10 flex flex-col items-center">

          {/* Cyberpunk Top Neon Line */}
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-indigo-500 to-transparent animate-pulse" />

          {/* Futuristic Icon Ring */}
          <div className="relative mb-6 flex items-center justify-center h-20 w-20 rounded-full border border-indigo-500/30 bg-indigo-950/30 shadow-[0_0_20px_rgba(99,102,241,0.2)] animate-pulse">
            <Network className="h-10 w-10 text-indigo-400" />
            <div className="absolute -inset-0.5 rounded-full bg-gradient-to-tr from-indigo-500 to-violet-500 opacity-20 blur-sm" />
          </div>

          <DialogHeader className="space-y-3 text-center w-full">
            <div className="text-[10px] text-indigo-400 font-bold uppercase tracking-[0.3em] flex items-center justify-center gap-1">
              <Cpu className="h-3 w-3 animate-spin" /> Incoming Deck Pairing
            </div>
            <DialogTitle className="text-2xl font-black uppercase tracking-wider bg-gradient-to-r from-zinc-100 via-indigo-200 to-zinc-100 bg-clip-text text-transparent">
              {peerHostname}
            </DialogTitle>
            <DialogDescription className="text-zinc-400 text-xs normal-case tracking-normal max-w-xs mx-auto">
              A device is requesting an air-gapped peer handshake to initiate end-to-end SQLite WAL database syncing and direct messaging.
            </DialogDescription>
          </DialogHeader>

          {/* Connection Metadata Panel */}
          <div className="w-full mt-6 p-4 rounded-xl border border-zinc-800 bg-zinc-900/50 backdrop-blur-md flex flex-col gap-2.5 text-xs text-zinc-300">
            <div className="flex justify-between items-center">
              <span className="text-zinc-500 uppercase tracking-widest text-[10px]">Host Address</span>
              <span className="font-bold text-zinc-100 selection:bg-indigo-500">{peerIp}</span>
            </div>
            <div className="h-[1px] bg-zinc-800/80 w-full" />
            <div className="flex justify-between items-center">
              <span className="text-zinc-500 uppercase tracking-widest text-[10px]">MAC Identity</span>
              <span className="font-bold text-indigo-300 select-all">{peerMac}</span>
            </div>
            <div className="h-[1px] bg-zinc-800/80 w-full" />
            <div className="flex justify-between items-center">
              <span className="text-zinc-500 uppercase tracking-widest text-[10px]">Security Status</span>
              <span className="font-bold text-emerald-400 uppercase tracking-wide flex items-center gap-1">
                <Sparkles className="h-3 w-3" /> VERIFIED LAN
              </span>
            </div>
          </div>

          {error && (
            <div className="w-full mt-4 p-3 rounded-lg border border-red-500/20 bg-red-950/20 text-red-400 text-xs flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Dialog Footer Actions */}
          <div className="w-full mt-8 grid grid-cols-2 gap-3">
            <button
              disabled={isLoading}
              onClick={onDecline}
              className="flex-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 uppercase tracking-widest text-xs h-12 rounded-xl transition-all font-mono"
            >
              DECLINE
            </button>
            <button
              disabled={isLoading}
              onClick={onIgnore}
              className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 uppercase tracking-widest text-xs h-12 rounded-xl transition-all font-mono"
            >
              IGNORE
            </button>
            <button
              disabled={isLoading}
              onClick={onBlock}
              className="bg-rose-950/40 hover:bg-rose-900/60 border border-rose-900/70 text-rose-300 uppercase tracking-widest text-xs h-12 rounded-xl transition-all font-mono"
            >
              BLOCK
            </button>
            <button
              disabled={isLoading}
              onClick={onAccept}
              className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 uppercase tracking-widest text-xs h-12 rounded-xl transition-all duration-300 font-bold flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-[0.98] font-mono"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  CONNECTING
                </>
              ) : (
                "ACCEPT"
              )}
            </button>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}
