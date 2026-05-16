"use client";

import React, { useEffect, useState } from "react";
import { MapPin, X, Send, Loader2, Navigation } from "lucide-react";

interface LocationData {
  lat: number;
  lng: number;
  accuracy: number;
  label?: string;
}

interface LocationShareProps {
  onClose: () => void;
  onSend: (payload: {
    content: string;
    type: string;
  }) => Promise<void>;
}

export function LocationShare({ onClose, onSend }: LocationShareProps) {
  const [loc,     setLoc]     = useState<LocationData | null>(null);
  const [error,   setError]   = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by this browser.");
      setLoading(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLoc({
          lat:      pos.coords.latitude,
          lng:      pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
        });
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  const mapUrl = loc
    ? `https://www.openstreetmap.org/?mlat=${loc.lat}&mlon=${loc.lng}&zoom=16`
    : null;

  const staticMapUrl = loc
    ? `https://staticmap.openstreetmap.de/staticmap.php?center=${loc.lat},${loc.lng}&zoom=16&size=640x320&markers=${loc.lat},${loc.lng},red`
    : null;

  const send = async () => {
    if (!loc) return;
    setSending(true);
    try {
      // Encode location as a special content string that chat-item.tsx can detect
      const content = `📍 Location shared\nlat:${loc.lat.toFixed(6)},lng:${loc.lng.toFixed(6)},acc:${loc.accuracy}`;
      await onSend({ content, type: "LOCATION" });
      onClose();
    } catch {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-[#1a1c23] animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
        <div className="flex items-center gap-x-3">
          <div className="h-9 w-9 rounded-full bg-emerald-500/20 flex items-center justify-center">
            <MapPin className="h-5 w-5 text-emerald-400" />
          </div>
          <span className="text-white font-bold">Share Location</span>
        </div>
        <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10">
          <X className="h-5 w-5 text-zinc-400" />
        </button>
      </div>

      {/* Map preview */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 gap-y-4">
        {loading && (
          <div className="flex flex-col items-center gap-y-3">
            <div className="h-16 w-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <Navigation className="h-8 w-8 text-emerald-400 animate-pulse" />
            </div>
            <p className="text-zinc-400 text-sm font-mono uppercase tracking-widest animate-pulse">
              Getting your location…
            </p>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center gap-y-3 text-center">
            <div className="h-16 w-16 rounded-full bg-rose-500/10 flex items-center justify-center">
              <MapPin className="h-8 w-8 text-rose-400" />
            </div>
            <p className="text-rose-400 text-sm">{error}</p>
          </div>
        )}

        {loc && (
          <>
            {/* Coordinate card */}
            <div className="w-full max-w-sm bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col gap-y-1">
              <div className="flex items-center gap-x-2 mb-2">
                <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-emerald-400 text-xs font-mono uppercase tracking-widest">
                  GPS Fix · ±{loc.accuracy}m
                </span>
              </div>
              <p className="text-white font-mono text-sm">
                {loc.lat.toFixed(6)}°N &nbsp; {loc.lng.toFixed(6)}°E
              </p>
              {mapUrl && (
                <a
                  href={mapUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 text-indigo-400 text-xs hover:underline truncate"
                >
                  View on OpenStreetMap →
                </a>
              )}
            </div>

            {/* Map thumbnail */}
            {staticMapUrl && (
              <div className="w-full max-w-sm rounded-2xl overflow-hidden border border-white/10 shadow-xl">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={staticMapUrl}
                  alt="Map preview"
                  className="w-full h-40 object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Send button */}
      <div className="px-6 pb-10 pt-4">
        <button
          onClick={send}
          disabled={!loc || sending}
          className="w-full py-4 rounded-2xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-white font-bold text-sm flex items-center justify-center gap-x-2 transition-all active:scale-[0.98]"
        >
          {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          Send Location
        </button>
      </div>
    </div>
  );
}
