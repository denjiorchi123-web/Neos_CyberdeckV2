"use client";

// Static top-level imports — Next.js can chunk these correctly.
// This whole file is only loaded client-side via dynamic() with ssr:false.
import { useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";

interface Props { socket: any; }

export default function TerminalXterm({ socket }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !socket) return;

    const term = new Terminal({
      theme: {
        background:          "#0d1117",
        foreground:          "#e2e8f0",
        cursor:              "#818cf8",
        selectionBackground: "#3730a3",
        black:               "#1e293b",
        red:                 "#f87171",
        green:               "#4ade80",
        yellow:              "#facc15",
        blue:                "#60a5fa",
        magenta:             "#c084fc",
        cyan:                "#22d3ee",
        white:               "#e2e8f0",
        brightBlack:         "#475569",
        brightWhite:         "#f8fafc",
      },
      fontFamily:       '"Cascadia Code", "Fira Code", "Courier New", monospace',
      fontSize:         13,
      lineHeight:       1.4,
      cursorBlink:      true,
      cursorStyle:      "block",
      scrollback:       5000,
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    socket.emit("terminal:create", { cols: term.cols, rows: term.rows });

    const onData = (data: string) => term.write(data);
    const onExit = () => term.write("\r\n\x1b[31m[process exited — click Terminal tab to restart]\x1b[0m\r\n");
    socket.on("terminal:data", onData);
    socket.on("terminal:exit", onExit);

    term.onData((data: string) => socket.emit("terminal:input", data));

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        socket.emit("terminal:resize", { cols: term.cols, rows: term.rows });
      } catch {}
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      socket.off("terminal:data", onData);
      socket.off("terminal:exit", onExit);
      socket.emit("terminal:kill");
      term.dispose();
    };
  }, [socket]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={containerRef}
      className="flex-1 w-full h-full p-2 bg-[#0d1117]"
      style={{ minHeight: 0 }}
    />
  );
}
