"use client";

import React, { useEffect, useRef } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { Hash, Maximize2, Trash2, Copy, Download } from 'lucide-react';

interface TerminalProps {
  nodeName?: string;
}

export const CyberTerminal = ({ nodeName = "DECK-01" }: TerminalProps) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      fontFamily: '"Share Tech Mono", monospace',
      fontSize: 14,
      theme: {
        background: '#1e1f22',
        foreground: '#dbdee1',
        cursor: '#5865f2',
        selectionBackground: 'rgba(88, 101, 242, 0.3)',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();

    term.writeln('\x1b[1;34mCYBERDECK SHELL v2.1.0\x1b[0m');
    term.writeln('NODE_AUTH: \x1b[1;32mGRANTED\x1b[0m');
    term.writeln(`REMOTE_HOST: ${nodeName}`);
    term.write(`\r\n\x1b[1;34m${nodeName.toLowerCase()}@deck:~$\x1b[0m `);

    const processCommand = (cmd: string) => {
      const command = cmd.trim().toLowerCase();
      term.write('\r\n');
      
      if (command === 'help') {
        term.writeln('AVAILABLE COMMANDS:');
        term.writeln('  status    - Check system vitals');
        term.writeln('  nodes     - List active network nodes');
        term.writeln('  clear     - Clear terminal buffer');
        term.writeln('  whoami    - Display current auth profile');
        term.writeln('  scan      - Execute network integrity scan');
      } else if (command === 'status') {
        term.writeln('\x1b[1;32mCPU: 12% | MEM: 4.2GB / 16GB | DISK: 124GB FREE\x1b[0m');
      } else if (command === 'nodes') {
        term.writeln('ID      NAME            STATUS      IP');
        term.writeln('01      CORE-NODE-01    ONLINE      10.0.0.1');
        term.writeln('02      EDGE-DECK-02    ONLINE      10.0.0.2');
        term.writeln('04      RECON-DECK-04   ONLINE      10.0.0.4');
      } else if (command === 'clear') {
        term.clear();
      } else if (command === 'whoami') {
        term.writeln('cyberdeck-admin (SECURE_PROFILE)');
      } else if (command === 'scan') {
        term.write('Scanning mesh network... ');
        setTimeout(() => {
          term.writeln('\r\n\x1b[1;32m[PASS]\x1b[0m Integrity verified. 5 peers active.');
          term.write(`\r\n\x1b[1;34m${nodeName.toLowerCase()}@deck:~$\x1b[0m `);
        }, 1500);
        return;
      } else if (command !== '') {
        term.writeln(`\x1b[1;31mCommand not found: ${command}\x1b[0m`);
      }
      
      term.write(`\r\n\x1b[1;34m${nodeName.toLowerCase()}@deck:~$\x1b[0m `);
    };

    let currentLine = '';
    term.onData(data => {
      const code = data.charCodeAt(0);
      if (code === 13) {
        processCommand(currentLine);
        currentLine = '';
      } else if (code === 127) {
        if (currentLine.length > 0) {
          currentLine = currentLine.slice(0, -1);
          term.write('\b \b');
        }
      } else {
        currentLine += data;
        term.write(data);
      }
    });

    xtermRef.current = term;

    const handleResize = () => fitAddon.fit();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
    };
  }, [nodeName]);

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-[#313338] h-full overflow-hidden">
      <div className="flex-1 flex flex-col p-4 overflow-hidden">
        <div className="w-full h-full bg-[#1e1f22] rounded-xl border border-white/10 overflow-hidden shadow-2xl flex flex-col">
          {/* Terminal Header */}
          <div className="flex items-center justify-between px-4 py-2 bg-[#2b2d31] border-b border-white/5">
            <div className="flex items-center space-x-2">
              <Hash size={14} className="text-indigo-400" />
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">{nodeName} — secure_shell</span>
            </div>
            <div className="flex items-center space-x-3 text-zinc-500">
              <Copy size={14} className="cursor-pointer hover:text-white transition" />
              <Download size={14} className="cursor-pointer hover:text-white transition" />
              <div className="h-3 w-[1px] bg-white/10 mx-1" />
              <Maximize2 size={14} className="cursor-pointer hover:text-white transition" />
              <Trash2 size={14} className="cursor-pointer hover:text-rose-500 transition" />
            </div>
          </div>
          
          {/* Terminal Body */}
          <div className="flex-1 p-2 overflow-hidden relative group">
            <div ref={terminalRef} className="w-full h-full" />
            <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-indigo-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>
      </div>
    </div>
  );
};
