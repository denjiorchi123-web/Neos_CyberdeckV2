"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Cpu, Loader2, Network, ShieldCheck, X, XCircle } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useModal } from "@/hooks/use-modal-store";

type PairingPhase = "idle" | "accepting" | "declining" | "connected" | "declined" | "failed";

const AUTO_DECLINE_MS = 30_000;

export function PairingRequestModal() {
  const { isOpen, onClose, type, data } = useModal();
  const router = useRouter();
  const isModalOpen = isOpen && type === "pairingRequest";
  const query = data.query || {};

  const requestId = typeof query.requestId === "string" ? query.requestId : "";
  const peerMac = String(query.fromNodeId || query.macAddress || query.mac || "").trim();
  const peerHostname = String(
    query.displayName ||
    query.publicName ||
    query.hostname ||
    peerMac ||
    "Unknown Peer",
  ).trim();
  const peerIp = String(query.ipAddress || query.hostAddress || query.ip || "Unknown").trim();
  const securityStatus = String(query.securityStatus || "UNKNOWN").trim();

  const [phase, setPhase] = useState<PairingPhase>("idle");
  const [error, setError] = useState("");
  const answeredRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isBusy = phase === "accepting" || phase === "declining";
  const isFinal = phase === "connected" || phase === "declined";
  const buttonsDisabled = isBusy || isFinal || !requestId;

  const statusView = useMemo(() => {
    if (phase === "accepting") return {
      label: "Writing trust record...",
      className: "border-amber-400/30 bg-amber-500/10 text-amber-200",
      icon: <Loader2 className="h-4 w-4 animate-spin" />,
    };
    if (phase === "declining") return {
      label: "Sending rejection...",
      className: "border-rose-400/30 bg-rose-500/10 text-rose-200",
      icon: <Loader2 className="h-4 w-4 animate-spin" />,
    };
    if (phase === "connected") return {
      label: "Connected",
      className: "border-emerald-400/40 bg-emerald-500/15 text-emerald-200",
      icon: <CheckCircle2 className="h-4 w-4" />,
    };
    if (phase === "declined") return {
      label: "Declined",
      className: "border-rose-400/40 bg-rose-500/15 text-rose-200",
      icon: <XCircle className="h-4 w-4" />,
    };
    if (phase === "failed") return {
      label: "Action failed",
      className: "border-rose-400/40 bg-rose-500/15 text-rose-200",
      icon: <XCircle className="h-4 w-4" />,
    };
    return {
      label: "Awaiting decision",
      className: "border-indigo-400/30 bg-indigo-500/10 text-indigo-200",
      icon: <ShieldCheck className="h-4 w-4" />,
    };
  }, [phase]);

  const clearCloseTimer = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };

  const scheduleClose = useCallback((delay = 1400) => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      onClose();
      router.refresh();
    }, delay);
  }, [onClose, router]);

  const respond = useCallback(async (action: "ACCEPTED" | "DECLINED", reason?: "timeout") => {
    if (!requestId || answeredRef.current) return;
    answeredRef.current = true;
    setError("");
    setPhase(action === "ACCEPTED" ? "accepting" : "declining");

    try {
      const res = await fetch("/api/peers/pair/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, action }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(body?.error || "Failed to answer pairing request");
      }

      setPhase(action === "ACCEPTED" ? "connected" : "declined");
      scheduleClose(action === "ACCEPTED" ? 1600 : reason === "timeout" ? 900 : 1200);
    } catch (err: any) {
      console.error(err);
      answeredRef.current = false;
      setPhase("failed");
      setError(err?.message || "Failed to update the trusted-peer relationship.");
    }
  }, [requestId, scheduleClose]);

  useEffect(() => {
    if (!isModalOpen) return;

    answeredRef.current = false;
    clearCloseTimer();
    setPhase("idle");
    setError("");

    const timeout = setTimeout(() => {
      void respond("DECLINED", "timeout");
    }, AUTO_DECLINE_MS);

    return () => {
      clearTimeout(timeout);
      clearCloseTimer();
    };
  }, [isModalOpen, requestId, respond]);

  const handleOpenChange = (open: boolean) => {
    if (open) return;
    if (isFinal || phase === "failed") onClose();
  };

  return (
    <Dialog open={isModalOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="[&>button]:hidden w-[min(430px,calc(100vw-28px))] max-w-none max-h-[448px] border border-indigo-500/30 bg-[#10131b]/96 text-white shadow-[0_0_44px_rgba(99,102,241,0.22)] rounded-3xl p-0 overflow-hidden font-mono">
        <div className="relative p-5">
          <div className="absolute top-0 inset-x-8 h-[2px] bg-gradient-to-r from-transparent via-indigo-400 to-transparent" />
          <button
            type="button"
            aria-label="Back"
            disabled={isBusy}
            onClick={onClose}
            className="absolute right-3 top-3 flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/5 text-zinc-300 transition active:scale-95 disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="flex items-center gap-4 pr-12">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-indigo-400/30 bg-indigo-500/10 shadow-[0_0_24px_rgba(99,102,241,0.2)]">
              <Network className="h-8 w-8 text-indigo-300" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.22em] text-indigo-200">
                <Cpu className="h-4 w-4" />
                Pairing
              </div>
              <DialogTitle className="mt-1 text-[20px] leading-6 font-black uppercase tracking-wide text-zinc-50">
                Incoming Deck Pairing
              </DialogTitle>
              <DialogDescription className="mt-1 text-[14px] leading-5 text-zinc-400">
                Accept only if this LAN device is physically connected and expected.
              </DialogDescription>
            </div>
          </div>

          <div className={`mt-4 min-h-12 rounded-xl border px-3 py-2 flex items-center gap-2 text-[13px] font-bold ${statusView.className}`}>
            {statusView.icon}
            <span>{statusView.label}</span>
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-3">
            <p className="text-[12px] uppercase tracking-[0.24em] text-zinc-500">Requesting peer</p>
            <h2 className="mt-1 truncate text-[19px] leading-6 font-black text-white">{peerHostname}</h2>
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/55 p-2.5">
                <p className="text-[12px] uppercase tracking-widest text-zinc-500">Host</p>
                <p className="mt-1 truncate text-[14px] font-bold text-zinc-100">{peerIp}</p>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/55 p-2.5">
                <p className="text-[12px] uppercase tracking-widest text-zinc-500">MAC</p>
                <p className="mt-1 truncate text-[14px] font-bold text-indigo-200">{peerMac || "Unknown"}</p>
              </div>
              <div className="col-span-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-2.5">
                <p className="text-[12px] uppercase tracking-widest text-emerald-300/70">Security Status</p>
                <p className="mt-1 flex items-center gap-2 truncate text-[14px] font-black uppercase text-emerald-200">
                  <ShieldCheck className="h-4 w-4 shrink-0" />
                  {securityStatus}
                </p>
              </div>
            </div>
          </div>

          {error && (
            <div className="mt-3 max-h-[68px] overflow-y-auto rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] leading-4 text-rose-200 touch-scroll">
              {error}
            </div>
          )}

          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={buttonsDisabled}
              onClick={() => void respond("DECLINED")}
              className="min-h-12 rounded-xl border border-rose-500/45 bg-rose-950/45 px-4 text-[13px] font-black uppercase tracking-widest text-rose-100 transition active:scale-[0.98] disabled:opacity-55"
            >
              Decline
            </button>
            <button
              type="button"
              disabled={buttonsDisabled}
              onClick={() => void respond("ACCEPTED")}
              className="min-h-12 rounded-xl border border-emerald-400/40 bg-emerald-500 px-4 text-[13px] font-black uppercase tracking-widest text-white shadow-lg shadow-emerald-500/20 transition active:scale-[0.98] disabled:opacity-55"
            >
              Accept
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
