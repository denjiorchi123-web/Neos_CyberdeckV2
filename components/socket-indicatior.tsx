"use client";

import React from "react";

import { useSocket } from "@/components/providers/socket-provider";
import { Badge } from "@/components/ui/badge";

export function SocketIndicatior() {
  const { isConnected } = useSocket();

  if (!isConnected)
    return (
      <Badge
        variant="outline"
        className="bg-rose-500/10 text-rose-500 border-rose-500/20 text-[10px] font-mono uppercase tracking-tighter"
      >
        <div className="w-1.5 h-1.5 rounded-full bg-rose-500 mr-1.5 animate-pulse" />
        OFFLINE / POLLING
      </Badge>
    );

  return (
    <Badge
      variant="outline"
      className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px] font-mono uppercase tracking-tighter"
    >
      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5" />
      ENCRYPTED / LIVE
    </Badge>
  );
}
