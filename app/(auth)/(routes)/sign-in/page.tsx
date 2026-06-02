"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock, User, ShieldCheck, ArrowRight, UserPlus } from "lucide-react";
import axios from "axios";
import { motion, AnimatePresence } from "framer-motion";

export default function LoginPage() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  
  // Registration fields
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const router = useRouter();

  const onLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier || !password) return;

    try {
      setIsLoading(true);
      setError("");
      
      // We first need to find the profile by identifier (name or email)
      // Since our auth API currently expects userId, we'll need an endpoint to verify by name/email
      // Or we can just try to find the profile on the server side in the auth API
      await axios.post("/api/auth", { 
        identifier, 
        password 
      });
      
      router.push("/");
      router.refresh();
    } catch (error: any) {
      setError(error.response?.data || "Invalid credentials");
    } finally {
      setIsLoading(false);
    }
  };

  const onRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newPassword) return;

    try {
      setIsLoading(true);
      const res = await axios.post("/api/profiles", { 
        name: newName,
        password: newPassword
      });
      // After registration, log them in
      await axios.post("/api/auth", { 
        identifier: res.data.name, 
        password: newPassword 
      });
      router.push("/");
      router.refresh();
    } catch (error: any) {
      setError(error.response?.data || "Registration failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-start py-8 px-6 bg-[#1e1f22] font-sans overflow-y-auto">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-[#313338] rounded-xl shadow-2xl overflow-hidden border border-white/5"
      >
        <div className="p-10">
          <div className="flex justify-center mb-8">
            <div className="h-16 w-16 rounded-2xl bg-indigo-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
              <ShieldCheck size={40} />
            </div>
          </div>
          
          <div className="text-center mb-10">
            <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">
              {isResetting ? "Reset Password" : isRegistering ? "Create Profile" : "Access Node"}
            </h1>
            <p className="text-zinc-400 text-sm">
              {isResetting ? "Set a new password for your mesh identity" : isRegistering ? "Initialize a new mesh identity" : "Enter credentials to decrypt your mesh profile"}
            </p>
          </div>

          <AnimatePresence mode="wait">
            {isResetting ? (
              <motion.form 
                key="reset"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                onSubmit={async (e) => {
                  e.preventDefault();
                  alert("Password reset requested. Local Node Admin approval required on AirGapped OS.");
                  setIsResetting(false);
                }} 
                className="space-y-6"
              >
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-x-2">
                      <User size={14} />
                      Name or Email
                    </label>
                    <input 
                      type="text"
                      autoFocus
                      disabled={isLoading}
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      className="w-full bg-[#1e1f22] text-white p-3.5 rounded-lg border border-white/5 focus:border-indigo-500 outline-none transition placeholder:text-zinc-600"
                      placeholder="e.g. Neo"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-x-2">
                      <Lock size={14} />
                      New Password
                    </label>
                    <input 
                      type="password"
                      disabled={isLoading}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full bg-[#1e1f22] text-white p-3.5 rounded-lg border border-white/5 focus:border-indigo-500 outline-none transition placeholder:text-zinc-600"
                      placeholder="••••••••"
                    />
                  </div>
                </div>

                <button 
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-amber-600 hover:bg-amber-700 disabled:bg-amber-600/50 text-white font-bold py-4 rounded-lg transition shadow-lg shadow-amber-500/20 flex items-center justify-center gap-x-2"
                >
                  {isLoading ? <Loader2 className="animate-spin" /> : "RESET PASSWORD"}
                </button>

                <div className="text-center pt-2">
                  <button 
                    type="button"
                    onClick={() => setIsResetting(false)}
                    className="text-zinc-500 hover:text-zinc-300 text-sm transition"
                  >
                    Back to login
                  </button>
                </div>
              </motion.form>
            ) : !isRegistering ? (
              <motion.form 
                key="login"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                onSubmit={onLogin} 
                className="space-y-6"
              >
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-x-2">
                      <User size={14} />
                      Name or Email
                    </label>
                    <input 
                      type="text"
                      autoFocus
                      disabled={isLoading}
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      className="w-full bg-[#1e1f22] text-white p-3.5 rounded-lg border border-white/5 focus:border-indigo-500 outline-none transition placeholder:text-zinc-600"
                      placeholder="e.g. Neo"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-x-2">
                      <Lock size={14} />
                      Password
                    </label>
                    <input 
                      type="password"
                      disabled={isLoading}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-[#1e1f22] text-white p-3.5 rounded-lg border border-white/5 focus:border-indigo-500 outline-none transition placeholder:text-zinc-600"
                      placeholder="••••••••"
                    />
                    <div className="flex justify-end mt-2">
                      <button 
                        type="button"
                        onClick={() => setIsResetting(true)}
                        className="text-[11px] text-indigo-400 hover:text-indigo-300 font-medium transition"
                      >
                        Forgot Password?
                      </button>
                    </div>
                  </div>
                </div>

                {error && (
                  <p className="text-rose-500 text-xs font-bold uppercase tracking-tight text-center">
                    {error}
                  </p>
                )}

                <button 
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-600/50 text-white font-bold py-4 rounded-lg transition shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-x-2 group"
                >
                  {isLoading ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <>
                      DECRYPT ACCESS
                      <ArrowRight size={18} className="group-hover:translate-x-1 transition" />
                    </>
                  )}
                </button>

                <div className="text-center pt-2">
                  <button 
                    type="button"
                    onClick={() => setIsRegistering(true)}
                    className="text-zinc-500 hover:text-zinc-300 text-sm transition flex items-center justify-center gap-x-2 mx-auto"
                  >
                    <UserPlus size={16} />
                    Create new profile
                  </button>
                </div>
              </motion.form>
            ) : (
              <motion.form 
                key="register"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                onSubmit={onRegister} 
                className="space-y-6"
              >
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-x-2">
                      <User size={14} />
                      Choose Name
                    </label>
                    <input 
                      type="text"
                      autoFocus
                      disabled={isLoading}
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      className="w-full bg-[#1e1f22] text-white p-3.5 rounded-lg border border-white/5 focus:border-indigo-500 outline-none transition placeholder:text-zinc-600"
                      placeholder="Enter a unique name"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-x-2">
                      <Lock size={14} />
                      Choose Password
                    </label>
                    <input 
                      type="password"
                      disabled={isLoading}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full bg-[#1e1f22] text-white p-3.5 rounded-lg border border-white/5 focus:border-indigo-500 outline-none transition placeholder:text-zinc-600"
                      placeholder="••••••••"
                    />
                  </div>
                </div>

                <button 
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-600/50 text-white font-bold py-4 rounded-lg transition shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-x-2"
                >
                  {isLoading ? <Loader2 className="animate-spin" /> : "INITIALIZE PROFILE"}
                </button>

                <div className="text-center pt-2">
                  <button 
                    type="button"
                    onClick={() => setIsRegistering(false)}
                    className="text-zinc-500 hover:text-zinc-300 text-sm transition"
                  >
                    Back to login
                  </button>
                </div>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
        
        <div className="bg-[#1e1f22] p-6 text-center border-t border-white/5">
          <div className="flex items-center justify-center gap-x-2 mb-2">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <p className="text-[10px] text-zinc-500 uppercase font-black tracking-[0.2em]">
              CyberDeck Node: ONLINE
            </p>
          </div>
          <p className="text-[9px] text-zinc-600 uppercase tracking-widest">
            AirGapped OS • Local Data Encryption Active
          </p>
        </div>
      </motion.div>
    </div>
  );
}
