"use client";

import React, { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

interface ChatResizableLayoutProps {
  navigation: React.ReactNode;
  sidebar: React.ReactNode;
  children: React.ReactNode;
}

const STORAGE_KEY = "cyberdeck-chat-sidebar-width";
const MIN_WIDTH = 288;
const MAX_WIDTH = 460;
const DEFAULT_WIDTH = 320;
const NAV_WIDTH = 72;

export function ChatResizableLayout({
  navigation,
  sidebar,
  children,
}: ChatResizableLayoutProps) {
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const saved = Number(window.localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(saved)) {
      setSidebarWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, saved)));
    }
  }, []);

  const setClampedWidth = (value: number) => {
    const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value));
    setSidebarWidth(next);
    window.localStorage.setItem(STORAGE_KEY, String(next));
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { startX: event.clientX, startWidth: sidebarWidth };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    setClampedWidth(dragRef.current.startWidth + event.clientX - dragRef.current.startX);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      className="h-full min-h-0 overflow-hidden"
      style={{ "--chat-sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}
    >
      <div className="hidden md:flex h-full w-[72px] z-30 flex-col fixed inset-y-0">
        {navigation}
      </div>

      <div
        className="hidden md:flex h-full z-20 flex-col fixed inset-y-0 left-[72px]"
        style={{ width: sidebarWidth }}
      >
        {sidebar}
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat list"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") setClampedWidth(sidebarWidth - 16);
          if (event.key === "ArrowRight") setClampedWidth(sidebarWidth + 16);
        }}
        className={cn(
          "chat-split-resizer hidden md:flex fixed inset-y-0 z-40 w-3 items-center justify-center",
          "cursor-col-resize touch-none outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        )}
        style={{ left: NAV_WIDTH + sidebarWidth - 6 }}
      >
        <span className="h-16 w-[3px] rounded-full bg-zinc-500/35 transition group-hover:bg-indigo-400" />
      </div>

      <main className="cyberdeck-main h-full min-h-0 overflow-hidden">{children}</main>
    </div>
  );
}
