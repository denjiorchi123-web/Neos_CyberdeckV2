"use client";

import React, { useEffect, useState, useCallback } from 'react';
import { Cpu, Database, Network, Lock, Zap, Users, Cable, Unplug } from 'lucide-react';
import { NodeMap } from './node-map';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import { useSocket, usePresence } from '@/components/providers/socket-provider';

interface Node {
  id: number;
  name: string;
  status: string;
  ip: string;
}

interface PresenceUser {
  userId: string;
  socketId?: string;
  nodeIp?: string;
  lastSeen?: number;
  status: "online" | "offline";
}

interface DashboardStatus {
  cpu: string;
  memory: string;
  nodes: Node[];
}

export const CyberDashboard = () => {
  const { isConnected } = useSocket();
  const { onlineUsers } = usePresence();
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [presenceData, setPresenceData] = useState<PresenceUser[]>([]);
  const [status, setStatus] = useState<DashboardStatus>({
    cpu: "0%",
    memory: "0%",
    nodes: []
  });

  // Fetch status from FastAPI backend
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
        const response = await axios.get(`${backendUrl}/api/status`);
        setStatus(response.data);
      } catch (error) {
        // Fallback for demo/dev without backend
        setStatus(prev => ({
          ...prev,
          cpu: `${Math.floor(Math.random() * 20) + 10}%`,
          memory: `${Math.floor(Math.random() * 15) + 30}%`,
          nodes: [
            { id: 1, name: "DECK-01", status: "online", ip: "10.0.0.1" },
            { id: 2, name: "DECK-02", status: "online", ip: "10.0.0.2" },
            { id: 3, name: "DECK-03", status: "offline", ip: "10.0.0.3" },
          ]
        }));
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  // Fetch initial presence and sync with socket updates
  const fetchPresence = useCallback(async () => {
    try {
      const res = await fetch("/api/presence");
      const data = await res.json();
      if (data?.online) {
        setPresenceData(data.online);
      }
    } catch {
      // Presence API may not be available
    }
  }, []);

  useEffect(() => {
    fetchPresence();
    const interval = setInterval(fetchPresence, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, [fetchPresence]);

  // Keep in sync with socket-level presence updates
  useEffect(() => {
    setPresenceData(onlineUsers);
  }, [onlineUsers]);

  return (
    <div className="space-y-6 animate-in fade-in duration-700">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Network Topology - Large Card */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="lg:col-span-2 bg-[#2b2d31]/50 backdrop-blur-md rounded-xl p-6 border border-white/10 shadow-2xl relative overflow-hidden group"
        >
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-500 opacity-50" />
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-indigo-500/10 rounded-lg">
                <Network size={20} className="text-indigo-400" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-widest">Network Topology</h3>
                <p className="text-[10px] text-zinc-500 font-mono">ACTIVE MESH PROTOCOL v4.2</p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              {/* Live Redis connection indicator */}
              <div className={`flex items-center space-x-1 px-2 py-1 rounded-full border ${
                isConnected 
                  ? 'bg-emerald-500/10 border-emerald-500/20' 
                  : 'bg-rose-500/10 border-rose-500/20'
              }`}>
                {isConnected ? (
                  <Cable size={10} className="text-emerald-500" />
                ) : (
                  <Unplug size={10} className="text-rose-500" />
                )}
                <div className={`w-1.5 h-1.5 rounded-full ${
                  isConnected 
                    ? 'bg-emerald-500 animate-pulse' 
                    : 'bg-rose-500'
                }`} />
                <span className={`text-[9px] font-bold uppercase ${
                  isConnected ? 'text-emerald-500' : 'text-rose-500'
                }`}>
                  {isConnected ? 'Live' : 'Offline'}
                </span>
              </div>
            </div>
          </div>
          <div className="h-[400px] bg-[#1e1f22]/80 rounded-xl border border-white/5 relative overflow-hidden inner-shadow">
            <NodeMap onNodeSelect={(node) => setSelectedNode(node)} />
            {/* Overlay grid effect */}
            <div className="absolute inset-0 pointer-events-none opacity-[0.03]" 
                 style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '20px 20px' }} 
            />
          </div>
        </motion.div>

        {/* System Vitals & Node Detail - Sidebar Card */}
        <div className="space-y-6">
          <AnimatePresence mode="wait">
            {selectedNode ? (
              <motion.div 
                key="node-detail"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="bg-[#2b2d31]/50 backdrop-blur-md rounded-xl p-6 border border-white/10 shadow-2xl relative overflow-hidden"
              >
                <div className="absolute top-0 right-0 p-2">
                  <button 
                    onClick={() => setSelectedNode(null)}
                    className="text-zinc-500 hover:text-white transition"
                  >
                    ×
                  </button>
                </div>
                <div className="flex items-center space-x-3 mb-6">
                  <div className="p-2 bg-indigo-500/10 rounded-lg">
                    <Database size={20} className="text-indigo-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-widest">{selectedNode.name}</h3>
                    <p className="text-[10px] text-zinc-500 font-mono">NODE_DETAILS_ENCRYPTED</p>
                  </div>
                </div>
                
                <div className="space-y-4">
                  <div className="flex justify-between border-b border-white/5 pb-2">
                    <span className="text-[10px] text-zinc-500 uppercase">IP Address</span>
                    <span className="text-[10px] text-zinc-300 font-mono">{selectedNode.ip}</span>
                  </div>
                  <div className="flex justify-between border-b border-white/5 pb-2">
                    <span className="text-[10px] text-zinc-500 uppercase">Status</span>
                    <span className={`text-[10px] font-bold uppercase ${selectedNode.status === 'online' ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {selectedNode.status}
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-white/5 pb-2">
                    <span className="text-[10px] text-zinc-500 uppercase">Encryption</span>
                    <span className="text-[10px] text-zinc-300 font-mono">AES-256-GCM</span>
                  </div>
                </div>

                <button 
                  className="w-full mt-6 py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-bold rounded-lg transition-all shadow-lg shadow-indigo-500/20"
                  onClick={() => {
                    window.location.href = window.location.href.replace('dashboard', `terminal?node=${selectedNode.name}`);
                  }}
                >
                  INITIALIZE SSH LINK
                </button>
              </motion.div>
            ) : (
              <motion.div 
                key="vitals"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="bg-[#2b2d31]/50 backdrop-blur-md rounded-xl p-6 border border-white/10 shadow-2xl"
              >
                <div className="flex items-center space-x-3 mb-6">
                  <div className="p-2 bg-yellow-500/10 rounded-lg">
                    <Zap size={20} className="text-yellow-400" />
                  </div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-widest">System Vitals</h3>
                </div>
                
                <div className="space-y-6">
                  <div className="space-y-2">
                    <div className="flex justify-between text-[11px] font-bold">
                      <span className="text-zinc-400 uppercase tracking-tighter flex items-center">
                        <Cpu size={12} className="mr-1.5" /> CPU UTILIZATION
                      </span>
                      <span className="text-indigo-400 font-mono">{status.cpu}</span>
                    </div>
                    <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: status.cpu }}
                        className="h-full bg-gradient-to-r from-indigo-600 to-indigo-400 shadow-[0_0_10px_rgba(99,102,241,0.5)]"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-[11px] font-bold">
                      <span className="text-zinc-400 uppercase tracking-tighter flex items-center">
                        <Database size={12} className="mr-1.5" /> MEMORY POOL
                      </span>
                      <span className="text-emerald-400 font-mono">{status.memory}</span>
                    </div>
                    <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: status.memory }}
                        className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.5)]"
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-10">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Peers Online</span>
                    <span className="text-[10px] font-mono text-zinc-500">{status.nodes.filter((n: any) => n.status === 'online').length}/{status.nodes.length}</span>
                  </div>
                  <div className="space-y-3">
                    {status.nodes.map((node: any, i) => (
                      <motion.div 
                        key={node.id} 
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.2 + (i * 0.1) }}
                        className="flex items-center justify-between bg-white/5 p-3 rounded-lg border border-white/5 hover:bg-white/10 transition group cursor-pointer"
                        onClick={() => setSelectedNode(node)}
                      >
                        <div className="flex items-center space-x-3">
                          <div className={`w-2 h-2 rounded-full ${node.status === 'online' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-rose-500'} transition-all duration-500`} />
                          <span className="text-xs text-zinc-200 font-mono font-medium group-hover:text-white transition">{node.name}</span>
                        </div>
                        <span className="text-[10px] text-zinc-500 font-mono group-hover:text-zinc-400 transition">{node.ip}</span>
                      </motion.div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Live Presence Panel ──────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 }}
            className="bg-[#2b2d31]/50 backdrop-blur-md rounded-xl p-6 border border-white/10 shadow-2xl relative overflow-hidden"
          >
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-cyan-500 via-teal-500 to-cyan-500 opacity-40" />
            <div className="flex items-center space-x-3 mb-4">
              <div className="p-2 bg-cyan-500/10 rounded-lg">
                <Users size={18} className="text-cyan-400" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-widest">Live Presence</h3>
                <p className="text-[10px] text-zinc-500 font-mono">
                  REDIS PUB/SUB • {presenceData.length} USER{presenceData.length !== 1 ? 'S' : ''} ONLINE
                </p>
              </div>
            </div>

            {presenceData.length === 0 ? (
              <div className="text-center py-6">
                <div className="text-zinc-600 text-[10px] font-mono">NO ACTIVE SESSIONS</div>
                <div className="text-zinc-700 text-[9px] font-mono mt-1">Waiting for Redis connection…</div>
              </div>
            ) : (
              <div className="space-y-2">
                {presenceData.map((user, i) => (
                  <motion.div
                    key={user.userId}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.05 * i }}
                    className="flex items-center justify-between bg-white/5 p-3 rounded-lg border border-white/5"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="relative">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-[9px] font-bold text-white">
                          {user.userId.slice(-3).toUpperCase()}
                        </div>
                        {/* Real green/red presence dot */}
                        <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#2b2d31] ${
                          user.status === 'online'
                            ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]'
                            : 'bg-rose-500'
                        }`} />
                      </div>
                      <div>
                        <div className="text-[10px] text-zinc-200 font-mono font-medium">
                          {user.userId.slice(0, 12)}…
                        </div>
                        <div className="text-[9px] text-zinc-600 font-mono">
                          {user.nodeIp || '127.0.0.1'}
                        </div>
                      </div>
                    </div>
                    <div className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${
                      user.status === 'online'
                        ? 'text-emerald-400 bg-emerald-500/10'
                        : 'text-rose-400 bg-rose-500/10'
                    }`}>
                      {user.status}
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-[#2b2d31]/50 backdrop-blur-md rounded-xl p-6 border border-white/10 shadow-2xl relative"
          >
            <div className="flex items-center space-x-3 mb-4">
              <div className="p-2 bg-rose-500/10 rounded-lg">
                <Lock size={18} className="text-rose-400" />
              </div>
              <h3 className="text-sm font-bold text-white uppercase tracking-widest text-rose-400">Security Vault</h3>
            </div>
            <div className="space-y-3 font-mono text-[10px]">
              <div className="flex items-start space-x-2 py-1 border-l-2 border-indigo-500 pl-3 bg-indigo-500/5">
                <span className="text-zinc-500 whitespace-nowrap">04:23:15</span>
                <span className="text-white">ENCRYPTED_TUNNEL: Established via node-4f2</span>
              </div>
              <div className="flex items-start space-x-2 py-1 border-l-2 border-emerald-500 pl-3">
                <span className="text-zinc-500 whitespace-nowrap">04:22:48</span>
                <span className="text-zinc-300">INTEGRITY_CHECK: All systems nominal</span>
              </div>
              <div className="flex items-start space-x-2 py-1 border-l-2 border-zinc-700 pl-3 opacity-50">
                <span className="text-zinc-500 whitespace-nowrap">04:20:12</span>
                <span className="text-zinc-400">HANDSHAKE_INIT: Peer 10.0.0.4 request...</span>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
};
