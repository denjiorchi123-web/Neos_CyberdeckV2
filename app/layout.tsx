import "./globals.css";
import "xterm/css/xterm.css";
import { cn } from "@/lib/utils";

import { ThemeProvider } from "@/components/providers/theme-provider";
import { ModalProvider } from "@/components/providers/modal-provider";
import { SocketProvider } from "@/components/providers/socket-provider";
import { QueryProvider } from "@/components/providers/query-provider";
import { CallProvider } from "../hooks/use-call-context";
import { IncomingCallOverlay } from "@/components/incoming-call-overlay";
import { OutgoingCallOverlay } from "@/components/outgoing-call-overlay";

import type { Metadata } from "next";
import { Open_Sans, Share_Tech_Mono } from "next/font/google";

// next/font/google fetches the fonts at *build time* on the WSL build host
// (which has internet) and self-hosts them in .next/static/media/. At runtime
// the Pi serves the fonts itself — no requests ever leave the LAN.
// This is the right choice for an air-gapped runtime with an online build host.
const openSans = Open_Sans({
  subsets: ["latin"],
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});
const mono = Share_Tech_Mono({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  fallback: ["ui-monospace", "monospace"],
});

export const metadata: Metadata = {
  title: "CyberDeck",
  description: "CyberDeck air-gapped LAN messenger.",
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={cn(
          openSans.className, 
          mono.variable,
          "bg-white dark:bg-[#313338]"
        )}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          storageKey="discord-clone-theme"
        >
          <SocketProvider>
            <ModalProvider />
            <CallProvider>
              {/* Global incoming/outgoing call UI — must live inside CallProvider so it
                  shares the call state regardless of which page the user is on. */}
              <IncomingCallOverlay />
              <OutgoingCallOverlay />
              <QueryProvider>{children}</QueryProvider>
            </CallProvider>
          </SocketProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
