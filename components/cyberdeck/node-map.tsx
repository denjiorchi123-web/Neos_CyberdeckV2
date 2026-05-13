"use client";

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const MOCK_NODES = [
  { id: 1, name: 'CORE-NODE-01', x: 250, y: 200, status: 'online', ip: '10.0.0.1', type: 'core' },
  { id: 2, name: 'EDGE-DECK-02', x: 400, y: 100, status: 'online', ip: '10.0.0.2', type: 'edge' },
  { id: 3, name: 'SATELLITE-03', x: 350, y: 320, status: 'offline', ip: '10.0.0.3', type: 'edge' },
  { id: 4, name: 'RECON-DECK-04', x: 100, y: 150, status: 'online', ip: '10.0.0.4', type: 'edge' },
  { id: 5, name: 'RELAY-05', x: 120, y: 300, status: 'online', ip: '10.0.0.5', type: 'relay' },
];

const CONNECTIONS = [
  { from: 1, to: 2, status: 'active', strength: 0.8 },
  { from: 1, to: 3, status: 'down', strength: 0.2 },
  { from: 1, to: 4, status: 'active', strength: 0.6 },
  { from: 4, to: 5, status: 'active', strength: 0.9 },
  { from: 2, to: 3, status: 'down', strength: 0.3 },
];

export const NodeMap = ({ onNodeSelect }: { onNodeSelect?: (node: any) => void }) => {
  return (
    <div className="w-full h-full relative bg-[#1e1f22] overflow-hidden cursor-crosshair">
      <svg className="w-full h-full p-10" viewBox="0 0 500 400" preserveAspectRatio="xMidYMid meet">
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="2.5" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
          <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#5865F2" stopOpacity="0" />
            <stop offset="50%" stopColor="#5865F2" stopOpacity="1" />
            <stop offset="100%" stopColor="#5865F2" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Connection Lines */}
        {CONNECTIONS.map((conn, i) => {
          const fromNode = MOCK_NODES.find(n => n.id === conn.from);
          const toNode = MOCK_NODES.find(n => n.id === conn.to);
          if (!fromNode || !toNode) return null;

          return (
            <g key={`conn-${i}`}>
              <motion.line
                x1={fromNode.x}
                y1={fromNode.y}
                x2={toNode.x}
                y2={toNode.y}
                stroke={conn.status === 'active' ? '#5865F2' : '#3f4147'}
                strokeWidth={conn.status === 'active' ? 1.5 : 1}
                strokeDasharray={conn.status === 'active' ? "none" : "4 4"}
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: conn.status === 'active' ? 0.3 : 0.1 }}
                transition={{ duration: 1.5, ease: "easeInOut" }}
              />
              
              {conn.status === 'active' && (
                <motion.circle
                  r={1.5}
                  fill="#fff"
                  filter="url(#glow)"
                  animate={{ 
                    cx: [fromNode.x, toNode.x],
                    cy: [fromNode.y, toNode.y],
                    opacity: [0, 1, 0]
                  }}
                  transition={{ 
                    duration: 3, 
                    repeat: Infinity, 
                    ease: "linear",
                    delay: i * 0.5
                  }}
                />
              )}
            </g>
          );
        })}

        {/* Nodes */}
        {MOCK_NODES.map((node) => (
          <motion.g 
            key={node.id} 
            className="group cursor-pointer"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: node.id * 0.1 }}
            whileHover={{ scale: 1.1 }}
            onClick={() => onNodeSelect?.(node)}
          >
            {/* Outer ring for online nodes */}
            {node.status === 'online' && (
              <motion.circle
                cx={node.x}
                cy={node.y}
                r={12}
                fill="transparent"
                stroke={node.type === 'core' ? '#5865F2' : '#23A559'}
                strokeWidth={1}
                strokeDasharray="2 2"
                animate={{ rotate: 360 }}
                transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
                className="opacity-40"
              />
            )}

            <circle
              cx={node.x}
              cy={node.y}
              r={node.type === 'core' ? 6 : 4}
              fill={node.status === 'online' ? (node.type === 'core' ? '#5865F2' : '#23A559') : '#F23F43'}
              className="filter drop-shadow-[0_0_8px_rgba(88,101,242,0.5)]"
            />
            
            <text
              x={node.x}
              y={node.y + 22}
              fill="#DBDEE1"
              fontSize="9"
              fontFamily="Share Tech Mono, monospace"
              textAnchor="middle"
              className="font-medium pointer-events-none uppercase tracking-tighter opacity-70 group-hover:opacity-100 transition-opacity"
            >
              {node.name}
            </text>
            
            <text
              x={node.x}
              y={node.y + 32}
              fill="#5865F2"
              fontSize="7"
              fontFamily="Share Tech Mono, monospace"
              textAnchor="middle"
              className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"
            >
              {node.ip}
            </text>
          </motion.g>
        ))}
      </svg>
      
      {/* Scanning line effect */}
      <motion.div 
        className="absolute top-0 left-0 w-full h-[1px] bg-indigo-500/20 shadow-[0_0_15px_rgba(99,102,241,0.5)] pointer-events-none"
        animate={{ top: ['0%', '100%', '0%'] }}
        transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
      />
    </div>
  );
};
