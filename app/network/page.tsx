"use client";

import React, { useEffect, useState } from "react";
import { Activity, Network, Server, Shield, Zap, Wifi, HardDrive, Cpu, TerminalSquare, RefreshCw, Edit2, ArrowLeft, Terminal } from "lucide-react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { EditNetworkConfigModal } from "@/components/modals/edit-network-config-modal";

interface Peer {
  ip: string;
  username?: string;
  hostname: string;
  online?: boolean;
  last_seen: number;
  joined_at: number;
}

interface ServiceEndpoint {
  ip: string;
  port: number;
  meta: any;
  last_seen: number;
}

interface NodeHealth {
  ip: string;
  ips?: string[];
  mac: string;
  hostname: string;
  ethernetReady?: boolean;
  ethernetMessage?: string;
  timestamp: number;
}

export default function NetworkDiagnosticsPage() {
  const [peers, setPeers] = useState<Record<string, Peer>>({});
  const [services, setServices] = useState<Record<string, ServiceEndpoint[]>>({});
  const [health, setHealth] = useState<NodeHealth | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRestarting, setIsRestarting] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  
  const router = useRouter();

  const fetchData = async () => {
    try {
      const [peersRes, servicesRes, healthRes, logsRes] = await Promise.all([
        fetch("/api/network/peers").then(r => r.json()),
        fetch("/api/network/services").then(r => r.json()),
        fetch("/api/network/health").then(r => r.json()),
        fetch("/api/network/logs").then(r => r.json())
      ]);

      if (peersRes.error || servicesRes.error || healthRes.error) {
        setError("Failed to read the local Node mesh state");
      } else {
        setPeers(peersRes);
        setServices(servicesRes);
        setHealth(healthRes);
        setError(null);
        setLastUpdate(new Date());
      }
      
      // Always update logs so crash errors are visible even if the daemon is dead
      if (Array.isArray(logsRes)) {
        setLogs(logsRes);
      }
    } catch (err) {
      setError("Failed to reach API endpoints");
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleRestart = async () => {
    setIsRestarting(true);
    try {
      await fetch("/api/network/restart", { method: "POST" });
      // Give it a second to restart and fetch fresh data
      setTimeout(() => {
        fetchData();
        setIsRestarting(false);
      }, 1500);
    } catch {
      setIsRestarting(false);
    }
  };

  const remotePeers = Object.entries(peers).filter(([mac]) => mac !== health?.mac);
  const totalPeers = remotePeers.length;
  const isHealthy = !error && health !== null;

  return (
    <div className="min-h-screen w-full flex-col bg-[#111214] text-zinc-300 p-6 font-mono">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-emerald-400 flex items-center gap-2 tracking-widest uppercase">
            <button 
              onClick={() => router.push("/")}
              className="p-1 hover:bg-zinc-800 rounded-md transition-colors mr-2"
              title="Back to Main Menu"
            >
              <ArrowLeft className="h-6 w-6 text-zinc-400 hover:text-emerald-400" />
            </button>
            <Network className="h-6 w-6" />
            Mesh Topology Diagnostics
            <button 
              onClick={handleRestart} 
              disabled={isRestarting}
              className="ml-4 p-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-md transition-all group disabled:opacity-50"
              title="Restart Mesh Daemon"
            >
              <RefreshCw className={`h-4 w-4 text-zinc-400 group-hover:text-emerald-400 ${isRestarting ? 'animate-spin text-emerald-400' : ''}`} />
            </button>
          </h1>
          <p className="text-zinc-500 text-sm mt-1">Air-Gapped Encrypted Mesh Network Control Center</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-xs text-zinc-500 uppercase tracking-widest">System Status</p>
            {isHealthy ? (
              <p className="text-emerald-400 font-bold flex items-center justify-end gap-1">
                <span className="relative flex h-2 w-2 mr-1">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                ONLINE
              </p>
            ) : (
              <p className="text-rose-500 font-bold flex items-center justify-end gap-1">
                <span className="h-2 w-2 rounded-full bg-rose-500 mr-1" />
                OFFLINE
              </p>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/50 text-rose-400 p-4 rounded-md mb-6 flex items-center gap-3">
          <Activity className="h-5 w-5" />
          <p>{error}</p>
        </div>
      )}

      {health && !health.ethernetReady && (
        <div className="bg-amber-500/10 border border-amber-500/50 text-amber-300 p-4 rounded-md mb-6 flex items-center gap-3">
          <Activity className="h-5 w-5" />
          <p>{health.ethernetMessage}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pb-20">
        
        {/* Left Column: Local Health & Node Info */}
        <div className="flex flex-col gap-6">
          <Card className="bg-zinc-900/50 border-zinc-800 shadow-xl shadow-black/50 relative group">
            <CardHeader className="pb-3 border-b border-zinc-800/50 flex flex-row items-center justify-between">
              <CardTitle className="text-emerald-400 text-sm flex items-center gap-2 uppercase tracking-widest">
                <TerminalSquare className="h-4 w-4" />
                Local Node Identity
              </CardTitle>
              <button 
                onClick={() => setIsEditModalOpen(true)}
                className="text-zinc-500 hover:text-emerald-400 transition-colors p-1"
                title="Edit Network Config"
              >
                <Edit2 className="h-4 w-4" />
              </button>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div>
                <p className="text-xs text-zinc-500 uppercase">Assigned IP Address</p>
                <p className="text-lg text-white font-bold tracking-wider">{health?.ip || "---.---.---.---"}</p>
                {health?.ips?.length ? (
                  <p className="text-[10px] text-zinc-500 font-mono mt-1">All IPv4: {health.ips.join(", ")}</p>
                ) : null}
              </div>
              <div>
                <p className="text-xs text-zinc-500 uppercase">Hardware MAC</p>
                <p className="text-sm text-zinc-300 font-mono">{health?.mac || "XX:XX:XX:XX:XX:XX"}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500 uppercase">Hostname</p>
                <p className="text-sm text-zinc-300">{health?.hostname || "Unknown"}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900/50 border-zinc-800 shadow-xl shadow-black/50 flex-1">
            <CardHeader className="pb-3 border-b border-zinc-800/50">
              <CardTitle className="text-indigo-400 text-sm flex items-center gap-2 uppercase tracking-widest">
                <Shield className="h-4 w-4" />
                Mesh Security
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-400">HMAC Beacon Verification</span>
                <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 bg-emerald-500/10">Active</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-400">Timestamp Replay Protection</span>
                <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 bg-emerald-500/10">30s Window</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-400">IP Collision Avoidance</span>
                <Badge variant="outline" className="border-indigo-500/30 text-indigo-400 bg-indigo-500/10">Random Arping</Badge>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Middle Column: Peer Topology */}
        <Card className="bg-zinc-900/50 border-zinc-800 shadow-xl shadow-black/50 md:col-span-2">
          <CardHeader className="pb-3 border-b border-zinc-800/50 flex flex-row items-center justify-between">
            <CardTitle className="text-emerald-400 text-sm flex items-center gap-2 uppercase tracking-widest">
              <Server className="h-4 w-4" />
              Connected Peers ({totalPeers})
            </CardTitle>
            {lastUpdate && (
              <span className="text-xs text-zinc-500">Updated: {lastUpdate.toLocaleTimeString()}</span>
            )}
          </CardHeader>
          <CardContent className="pt-4 p-6">
            <div className="space-y-3">
              {remotePeers.map(([mac, peer]) => {
                const age = health ? health.timestamp - peer.last_seen : 0;
                const statusColor = age > 15 ? "bg-rose-500" : age > 5 ? "bg-amber-500" : "bg-emerald-500";
                
                return (
                  <div key={mac} className="flex items-center justify-between bg-black/40 border border-zinc-800/50 p-3 rounded-lg hover:border-emerald-500/30 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className={`h-2 w-2 rounded-full ${statusColor} shadow-[0_0_8px_rgba(0,0,0,0.5)]`} />
                      <div>
                        <p className="text-sm font-bold text-white flex items-center gap-2">
                          {peer.username || "Unknown peer"}
                        </p>
                        <p className="text-xs text-zinc-500 font-mono mt-0.5">
                          {peer.hostname || "device"} / {mac}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-emerald-400 font-mono font-bold tracking-wider">{peer.ip}</p>
                      <p className="text-[10px] text-zinc-500 uppercase mt-1">Seen {age.toFixed(1)}s ago</p>
                    </div>
                  </div>
                );
              })}
              {totalPeers === 0 && !error && (
                <div className="text-center py-10 text-zinc-500 text-sm italic">
                  Waiting for peers...
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Bottom Row spanning all columns: Decentralized Service Registry */}
        <Card className="bg-zinc-900/50 border-zinc-800 shadow-xl shadow-black/50 md:col-span-3">
          <CardHeader className="pb-3 border-b border-zinc-800/50">
            <CardTitle className="text-amber-400 text-sm flex items-center gap-2 uppercase tracking-widest">
              <Zap className="h-4 w-4" />
              Decentralized Service Registry
            </CardTitle>
            <CardDescription className="text-zinc-500 text-xs">Services discovered across the mesh network via signed beacons.</CardDescription>
          </CardHeader>
          <CardContent className="pt-4 p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-4">
               {Object.entries(services).length === 0 ? (
                 <div className="col-span-full text-center py-6 text-zinc-500 text-sm italic">
                   No services currently advertised on the mesh.
                 </div>
               ) : (
                 Object.entries(services).map(([name, providers]) => (
                   <div key={name} className="bg-black/40 border border-amber-500/20 p-4 rounded-lg">
                     <div className="flex items-center gap-2 mb-3 pb-2 border-b border-zinc-800">
                       <HardDrive className="h-4 w-4 text-amber-500" />
                       <h3 className="font-bold text-amber-400 uppercase tracking-widest text-sm">{name}</h3>
                     </div>
                     <div className="space-y-2">
                       {providers.map((p, i) => (
                         <div key={i} className="flex justify-between items-center text-xs">
                           <span className="font-mono text-zinc-300">{p.ip}:{p.port}</span>
                           <span className="text-zinc-500">{(health ? health.timestamp - p.last_seen : 0).toFixed(0)}s ago</span>
                         </div>
                       ))}
                     </div>
                   </div>
                 ))
               )}
            </div>
          </CardContent>
        </Card>

        {/* Bottom Row spanning all columns: Networking Logs */}
        <Card className="bg-zinc-900/50 border-zinc-800 shadow-xl shadow-black/50 md:col-span-3">
          <CardHeader className="pb-3 border-b border-zinc-800/50">
            <CardTitle className="text-indigo-400 text-sm flex items-center gap-2 uppercase tracking-widest">
              <Terminal className="h-4 w-4" />
              Live Networking Logs
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 p-6">
            <div className="bg-black/80 rounded-md p-4 font-mono text-xs overflow-x-auto border border-zinc-800 h-64 overflow-y-auto">
              {logs.length === 0 ? (
                <div className="text-zinc-500 italic">No logs available. Daemon might be initializing...</div>
              ) : (
                logs.map((logStr, idx) => (
                  <div key={idx} className="whitespace-pre text-zinc-300">
                    {logStr}
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <EditNetworkConfigModal 
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        onSaved={() => {
          // Trigger a refresh of the dashboard to catch new assigned IP/ports
          setTimeout(fetchData, 1500);
        }}
      />
    </div>
  );
}
