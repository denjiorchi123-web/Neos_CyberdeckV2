"use client";

import React, { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";

type MapNode = {
  id: string;
  name: string;
  ip: string;
  status: "online" | "offline";
  trustStatus?: string;
  type: "core" | "peer";
  x: number;
  y: number;
};

export const NodeMap = ({ onNodeSelect }: { onNodeSelect?: (node: any) => void }) => {
  const [nodes, setNodes] = useState<MapNode[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [health, peers] = await Promise.all([
        fetch("/api/network/health", { cache: "no-store" }).then(res => res.json()),
        fetch("/api/network/peers", { cache: "no-store" }).then(res => res.json()),
      ]);

      const peerEntries = Object.entries(peers) as [string, any][];
      const radius = 130;
      const mappedPeers = peerEntries.map(([mac, peer], index): MapNode => {
        const angle = (Math.PI * 2 * index) / Math.max(peerEntries.length, 1) - Math.PI / 2;
        return {
          id: mac,
          name: peer.username || "Unknown peer",
          ip: peer.ip || "",
          status: Date.now() / 1000 - peer.last_seen < 30 ? "online" : "offline",
          trustStatus: peer.trust_status,
          type: "peer",
          x: 250 + Math.cos(angle) * radius,
          y: 200 + Math.sin(angle) * radius,
        };
      });

      setNodes([
        {
          id: health.mac || "local",
          name: health.hostname || "LOCAL NODE",
          ip: health.ip || "127.0.0.1",
          status: "online",
          type: "core",
          x: 250,
          y: 200,
        },
        ...mappedPeers,
      ]);
    } catch {
      setNodes([]);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const core = nodes.find(node => node.type === "core");
  const peers = nodes.filter(node => node.type === "peer");

  return (
    <div className="w-full h-full relative bg-[#1e1f22] overflow-hidden cursor-crosshair">
      <svg className="w-full h-full p-10" viewBox="0 0 500 400" preserveAspectRatio="xMidYMid meet">
        {core && peers.map((peer) => (
          <motion.line
            key={`connection-${peer.id}`}
            x1={core.x}
            y1={core.y}
            x2={peer.x}
            y2={peer.y}
            stroke={peer.status === "online" ? "#5865F2" : "#3f4147"}
            strokeWidth={peer.status === "online" ? 1.5 : 1}
            strokeDasharray={peer.status === "online" ? "none" : "4 4"}
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: peer.status === "online" ? 0.4 : 0.15 }}
          />
        ))}

        {nodes.map((node, index) => (
          <motion.g
            key={node.id}
            className="group cursor-pointer"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: index * 0.08 }}
            whileHover={{ scale: 1.1 }}
            onClick={() => onNodeSelect?.(node)}
          >
            {node.status === "online" && (
              <circle
                cx={node.x}
                cy={node.y}
                r={12}
                fill="transparent"
                stroke={node.type === "core" ? "#5865F2" : "#23A559"}
                strokeWidth={1}
                strokeDasharray="2 2"
                className="opacity-40"
              />
            )}
            <circle
              cx={node.x}
              cy={node.y}
              r={node.type === "core" ? 6 : 4}
              fill={node.status === "online" ? (node.type === "core" ? "#5865F2" : "#23A559") : "#F23F43"}
            />
            <text x={node.x} y={node.y + 22} fill="#DBDEE1" fontSize="9" textAnchor="middle">
              {node.name}
            </text>
            <text x={node.x} y={node.y + 32} fill="#5865F2" fontSize="7" textAnchor="middle">
              {node.ip}
            </text>
          </motion.g>
        ))}
      </svg>
      <motion.div
        className="absolute top-0 left-0 w-full h-[1px] bg-indigo-500/20"
        animate={{ top: ["0%", "100%", "0%"] }}
        transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
      />
    </div>
  );
};
