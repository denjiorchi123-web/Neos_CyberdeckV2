"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Camera, Check, AlertCircle, Loader2, Lock, LogOut,
  Pencil, Save, Trash2, User, X, Eye, EyeOff, ShieldAlert, ChevronLeft
} from "lucide-react";
import { format } from "date-fns";
import axios from "axios";
import { useRouter } from "next/navigation";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Profile {
  id: string;
  name: string;
  email: string;
  imageUrl: string;
  createdAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Toast({ msg, onDone }: { msg: { ok: boolean; text: string }; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-2xl text-sm font-medium border z-50 ${
      msg.ok ? "bg-emerald-900 border-emerald-700 text-emerald-200" : "bg-rose-900 border-rose-700 text-rose-200"
    }`}>
      {msg.ok ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
      {msg.text}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const router = useRouter();
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [profile,    setProfile]    = useState<Profile | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [toast,      setToast]      = useState<{ ok: boolean; text: string } | null>(null);

  // Edit fields
  const [editName,   setEditName]   = useState("");
  const [editEmail,  setEditEmail]  = useState("");
  const [saving,     setSaving]     = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [uploading,  setUploading]  = useState(false);

  // Password change
  const [curPass,    setCurPass]    = useState("");
  const [newPass,    setNewPass]    = useState("");
  const [confPass,   setConfPass]   = useState("");
  const [showPw,     setShowPw]     = useState(false);
  const [changingPw, setChangingPw] = useState(false);
  const [imgError,   setImgError]   = useState(false);

  // Delete
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting,      setDeleting]      = useState(false);

  // Lightbox
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const notify = (ok: boolean, text: string) => setToast({ ok, text });

  const activateTouchScroll = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") {
      event.currentTarget.classList.add("touch-scroll-active");
    }
  };

  const deactivateTouchScroll = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.classList.remove("touch-scroll-active");
  };

  useEffect(() => {
    fetch("/api/profile/stats")
      .then(r => r.json())
      .then(d => {
        const p = d.profile;
        setProfile({ ...p, email: p.email ?? "" });
        setEditName(p.name ?? "");
        setEditEmail(p.email ?? "");
      })
      .finally(() => setLoading(false));
  }, []);

  // ── Avatar upload ──────────────────────────────────────────────────────────

  const handleAvatarFile = async (file: File) => {
    if (!profile) return;
    const reader = new FileReader();
    reader.onload = e => setAvatarPreview(e.target?.result as string);
    reader.readAsDataURL(file);

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("type", "image");
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!data.url) throw new Error("Upload failed");

      await axios.patch(`/api/profiles/${profile.id}`, { imageUrl: data.url });
      setProfile(p => p ? { ...p, imageUrl: data.url } : p);
      setAvatarPreview(null);
      setImgError(false);
      notify(true, "Avatar updated");
      router.refresh(); // Refresh layout so the sidebar avatar updates
    } catch (e: any) {
      setAvatarPreview(null);
      notify(false, e.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  // ── Save profile details ───────────────────────────────────────────────────

  const saveProfile = async () => {
    if (!profile) return;
    if (!editName.trim()) { notify(false, "Name cannot be empty"); return; }
    setSaving(true);
    try {
      const res = await axios.patch(`/api/profiles/${profile.id}`, {
        name:     editName.trim(),
        email:    editEmail.trim() || undefined,
        imageUrl: profile.imageUrl,
      });
      setProfile(p => p ? { ...p, name: res.data.name, email: res.data.email ?? "" } : p);
      notify(true, "Profile saved");
    } catch (e: any) {
      notify(false, e.response?.data ?? e.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  // ── Change password ────────────────────────────────────────────────────────

  const changePassword = async () => {
    if (!profile) return;
    if (newPass.length < 4) { notify(false, "Password must be at least 4 characters"); return; }
    if (newPass !== confPass) { notify(false, "Passwords do not match"); return; }
    setChangingPw(true);
    try {
      const res = await fetch(`/api/profiles/${profile.id}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: curPass, newPassword: newPass }),
      });
      if (!res.ok) throw new Error(await res.text());
      setCurPass(""); setNewPass(""); setConfPass("");
      notify(true, "Password changed");
    } catch (e: any) {
      notify(false, e.message ?? "Failed to change password");
    } finally {
      setChangingPw(false);
    }
  };

  // ── Delete account ─────────────────────────────────────────────────────────

  const deleteAccount = async () => {
    if (!profile) return;
    setDeleting(true);
    try {
      await axios.delete(`/api/profiles/${profile.id}`);
      await axios.delete("/api/auth");
      window.location.href = "/sign-in";
    } catch (e: any) {
      notify(false, e.message ?? "Delete failed");
      setDeleting(false);
      setDeleteConfirm(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  const avatarSrc = avatarPreview ?? profile?.imageUrl ?? "";
  const initials  = (profile?.name ?? "?").charAt(0).toUpperCase();

  return (
    <div
      tabIndex={0}
      onPointerDown={activateTouchScroll}
      onPointerUp={deactivateTouchScroll}
      onPointerCancel={deactivateTouchScroll}
      onPointerLeave={deactivateTouchScroll}
      className="touch-scroll flex flex-col h-full bg-white dark:bg-[#313338] overflow-y-auto"
    >
      {toast && <Toast msg={toast} onDone={() => setToast(null)} />}

      {lightboxOpen && avatarSrc && !imgError && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/90 backdrop-blur-sm" onClick={() => setLightboxOpen(false)}>
          <button className="absolute top-4 left-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-medium transition z-[1000]">
            <X className="h-5 w-5" /> Back
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={avatarSrc} alt={profile?.name || "Profile Photo"} className="max-w-[90vw] max-h-[90vh] rounded-xl object-contain shadow-2xl" onClick={e => e.stopPropagation()} />
        </div>
      )}

      <div className="max-w-2xl mx-auto w-full px-6 py-10 space-y-8">

        {/* ── Header ──────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="p-2 -ml-2 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-700/50 text-zinc-500 dark:text-zinc-400 transition"
              title="Go back"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <h1 className="text-2xl font-bold text-black dark:text-white">Account Settings</h1>
          </div>
          <button
            onClick={async () => { await axios.delete("/api/auth"); window.location.href = "/sign-in"; }}
            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-rose-400 transition px-3 py-1.5 rounded-lg hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20"
          >
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>

        {/* ── Avatar ──────────────────────────────────────────────── */}
        <section className="bg-zinc-100 dark:bg-[#2b2d31] rounded-2xl p-6 border border-black/5 dark:border-white/5">
          <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-5">Profile Photo</h2>
          <div className="flex items-center gap-x-6">
            <div className="relative group">
              {(avatarSrc && !imgError) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img 
                  src={avatarSrc} 
                  alt={profile?.name} 
                  onClick={() => setLightboxOpen(true)}
                  className="h-20 w-20 rounded-full object-cover ring-4 ring-indigo-500/30 cursor-pointer hover:opacity-90 transition"
                  onError={() => setImgError(true)}
                />
              ) : (
                <div className="h-20 w-20 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-3xl font-bold text-white ring-4 ring-indigo-500/30 cursor-pointer" onClick={() => setLightboxOpen(true)}>
                  {initials}
                </div>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); avatarInputRef.current?.click(); }}
                disabled={uploading}
                className="absolute inset-0 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                title="Change photo"
              >
                {uploading ? <Loader2 className="h-6 w-6 text-white animate-spin" /> : <Camera className="h-6 w-6 text-white" />}
              </button>
            </div>
            <div>
              <p className="text-sm font-medium text-black dark:text-white">{profile?.name}</p>
              <button
                onClick={() => avatarInputRef.current?.click()}
                disabled={uploading}
                className="mt-4 px-4 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-sm font-semibold rounded-lg flex items-center gap-2 transition"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                {uploading ? "Uploading..." : "Change Photo"}
              </button>
              <p className="mt-2 text-xs text-zinc-500">
                Click the photo to view it full-screen.
              </p>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleAvatarFile(f); e.target.value = ""; }}
              />
            </div>
            <div>
              <p className="text-sm font-medium text-black dark:text-white">{profile?.name}</p>
              <p className="text-xs text-zinc-500 mt-0.5">{profile?.email}</p>
              <button
                onClick={() => avatarInputRef.current?.click()}
                disabled={uploading}
                className="mt-2 text-xs text-indigo-400 hover:text-indigo-300 transition flex items-center gap-1"
              >
                <Camera className="h-3 w-3" />
                {uploading ? "Uploading…" : "Change photo"}
              </button>
            </div>
          </div>
        </section>

        {/* ── Profile Details ──────────────────────────────────────── */}
        <section className="bg-zinc-100 dark:bg-[#2b2d31] rounded-2xl p-6 border border-black/5 dark:border-white/5 space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Profile Details</h2>

          <div className="space-y-1.5">
            <label className="text-xs text-zinc-500 block">Display Name</label>
            <input
              value={editName}
              onChange={e => setEditName(e.target.value)}
              className="w-full bg-white dark:bg-[#1e1f22] border border-zinc-300 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-black dark:text-white focus:outline-none focus:border-indigo-500 transition"
              placeholder="Your name"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-zinc-500 block">Email Address</label>
            <input
              value={editEmail}
              onChange={e => setEditEmail(e.target.value)}
              className="w-full bg-white dark:bg-[#1e1f22] border border-zinc-300 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-black dark:text-white focus:outline-none focus:border-indigo-500 transition"
              placeholder="you@cyberdeck.local"
            />
          </div>

          {profile?.createdAt && (
            <p className="text-[11px] text-zinc-600">
              Member since {format(new Date(profile.createdAt), "d MMMM yyyy")}
            </p>
          )}

          <button
            onClick={saveProfile}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition text-white text-sm font-bold"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Changes
          </button>
        </section>

        {/* ── Change Password ──────────────────────────────────────── */}
        <section className="bg-zinc-100 dark:bg-[#2b2d31] rounded-2xl p-6 border border-black/5 dark:border-white/5 space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-2">
            <Lock className="h-3.5 w-3.5" /> Change Password
          </h2>

          {[
            { label: "Current Password",  val: curPass,  set: setCurPass  },
            { label: "New Password",       val: newPass,  set: setNewPass  },
            { label: "Confirm Password",   val: confPass, set: setConfPass },
          ].map(({ label, val, set }) => (
            <div key={label} className="space-y-1.5">
              <label className="text-xs text-zinc-500 block">{label}</label>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  value={val}
                  onChange={e => set(e.target.value)}
                  className="w-full bg-white dark:bg-[#1e1f22] border border-zinc-300 dark:border-zinc-700 rounded-xl px-4 py-2.5 pr-10 text-sm text-black dark:text-white focus:outline-none focus:border-indigo-500 transition"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(s => !s)}
                  className="absolute right-3 top-2.5 text-zinc-500 hover:text-zinc-300 transition"
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          ))}

          <button
            onClick={changePassword}
            disabled={changingPw || !newPass}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 transition text-white text-sm font-bold"
          >
            {changingPw ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            Update Password
          </button>
        </section>

        {/* ── Danger Zone ──────────────────────────────────────────── */}
        <section className="bg-rose-950/30 rounded-2xl p-6 border border-rose-800/40 space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-widest text-rose-500 flex items-center gap-2">
            <ShieldAlert className="h-3.5 w-3.5" /> Danger Zone
          </h2>

          {!deleteConfirm ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-rose-300">Delete Account</p>
                <p className="text-xs text-rose-700 mt-0.5">This will permanently delete your profile and all data.</p>
              </div>
              <button
                onClick={() => setDeleteConfirm(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600/20 hover:bg-rose-600/40 border border-rose-600/40 text-rose-400 text-sm font-bold transition"
              >
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm font-bold text-rose-300">Are you absolutely sure?</p>
              <p className="text-xs text-rose-600">
                All your messages, servers, and data will be permanently deleted. This cannot be undone.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={deleteAccount}
                  disabled={deleting}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 transition text-white text-sm font-bold"
                >
                  {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Yes, delete my account
                </button>
                <button
                  onClick={() => setDeleteConfirm(false)}
                  className="px-5 py-2.5 rounded-xl bg-zinc-700 hover:bg-zinc-600 transition text-white text-sm font-bold"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
