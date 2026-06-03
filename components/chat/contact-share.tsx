"use client";

import React, { useEffect, useState } from "react";
import { User, X, Send, Loader2, Search } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import axios from "axios";

interface ProfileInfo {
  id: string;
  name: string;
  email: string;
  imageUrl: string;
}

interface ContactShareProps {
  onClose: () => void;
  onSend: (payload: {
    content: string;
    type: string;
  }) => Promise<void>;
}

export function ContactShare({ onClose, onSend }: ContactShareProps) {
  const [profiles,  setProfiles]  = useState<ProfileInfo[]>([]);
  const [filtered,  setFiltered]  = useState<ProfileInfo[]>([]);
  const [query,     setQuery]     = useState("");
  const [selected,  setSelected]  = useState<ProfileInfo | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [sending,   setSending]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  const activateTouchScroll = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") {
      event.currentTarget.classList.add("touch-scroll-active");
    }
  };

  const deactivateTouchScroll = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.classList.remove("touch-scroll-active");
  };

  useEffect(() => {
    axios.get("/api/profiles")
      .then(res => {
        const list: ProfileInfo[] = Array.isArray(res.data) ? res.data : (res.data?.profiles ?? []);
        setProfiles(list);
        setFiltered(list);
      })
      .catch(() => setError("Could not load contacts"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const q = query.toLowerCase();
    setFiltered(q ? profiles.filter(p => p.name.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q)) : profiles);
  }, [query, profiles]);

  const send = async () => {
    if (!selected) return;
    setSending(true);
    try {
      // Encode as vCard-style content string chat-item.tsx can detect
      const content = `👤 Contact: ${selected.name}\nemail:${selected.email || ""}`;
      await onSend({ content, type: "CONTACT" });
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
          <div className="h-9 w-9 rounded-full bg-blue-500/20 flex items-center justify-center">
            <User className="h-5 w-5 text-blue-400" />
          </div>
          <span className="text-white font-bold">Share Contact</span>
        </div>
        <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10">
          <X className="h-5 w-5 text-zinc-400" />
        </button>
      </div>

      {/* Search */}
      <div className="px-4 py-3">
        <div className="flex items-center gap-x-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2">
          <Search className="h-4 w-4 text-zinc-400 shrink-0" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search contacts…"
            className="flex-1 bg-transparent text-white text-sm outline-none placeholder:text-zinc-500"
          />
        </div>
      </div>

      {/* List */}
      <div
        tabIndex={0}
        onPointerDown={activateTouchScroll}
        onPointerUp={deactivateTouchScroll}
        onPointerCancel={deactivateTouchScroll}
        onPointerLeave={deactivateTouchScroll}
        className="touch-scroll flex-1 min-h-0 overflow-y-auto px-4 pb-4 space-y-1"
      >
        {loading && (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 text-zinc-500 animate-spin" />
          </div>
        )}
        {error && <p className="text-rose-400 text-sm text-center py-8">{error}</p>}
        {!loading && filtered.map(profile => (
          <button
            key={profile.id}
            onClick={() => setSelected(prev => prev?.id === profile.id ? null : profile)}
            className={`w-full flex items-center gap-x-3 px-3 py-3 rounded-xl transition-all ${
              selected?.id === profile.id
                ? "bg-blue-500/20 border border-blue-500/40"
                : "hover:bg-white/5 border border-transparent"
            }`}
          >
            <UserAvatar src={profile.imageUrl} className="h-10 w-10 shrink-0" />
            <div className="flex flex-col items-start flex-1 min-w-0">
              <span className="text-white font-medium text-sm truncate w-full text-left">{profile.name}</span>
              {profile.email && (
                <span className="text-zinc-500 text-xs truncate w-full text-left">{profile.email}</span>
              )}
            </div>
            {selected?.id === profile.id && (
              <div className="h-5 w-5 rounded-full bg-blue-500 flex items-center justify-center shrink-0">
                <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Send button */}
      {selected && (
        <div className="px-6 pb-10 pt-4 border-t border-white/5">
          <button
            onClick={send}
            disabled={sending}
            className="w-full py-4 rounded-2xl bg-blue-500 hover:bg-blue-400 disabled:opacity-40 text-white font-bold text-sm flex items-center justify-center gap-x-2 transition-all active:scale-[0.98]"
          >
            {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            Send {selected.name}
          </button>
        </div>
      )}
    </div>
  );
}
