"use client";

import React from "react";
import { Video, VideoOff } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import qs from "query-string";
import { v4 as uuidv4 } from "uuid";
import { useEffect, useState, useTransition } from "react";

import { ActionTooltip } from "@/components/action-tooltip";
import { isWebRTCSupported } from "@/lib/webrtc-support";
import { useModal } from "@/hooks/use-modal-store";
import { usePreferences } from "@/components/providers/socket-provider";

interface ChatVideoButtonProps {
  chatId?: string;
  name?: string;
  serverId?: string;
  otherMemberId?: string;
  callerMemberId?: string;
  currentProfileName?: string;
}

export function ChatVideoButton({ 
  chatId, 
  name,
  serverId,
  otherMemberId,
  callerMemberId,
  currentProfileName
}: ChatVideoButtonProps) {
  const searchParams = useSearchParams();
  const pathName = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { onOpen } = useModal();
  const { lockedChats } = usePreferences();

  // Scenario #12 — disable the button on browsers without WebRTC.
  const [supported, setSupported] = useState(true);
  useEffect(() => { setSupported(isWebRTCSupported()); }, []);

  const isVideo = searchParams?.get("video");
  const isLocked = chatId ? lockedChats.some((lc: any) => lc.chatId === chatId) : false;

  const Icon = isVideo ? VideoOff : Video;
  const tooltipLabel = !supported
    ? "Video calls not supported in this browser"
    : (isVideo ? "End video call" : "Start video call");

  const buildCallUrl = () => {
    const isStarting = !isVideo;
    return qs.stringifyUrl(
      {
        url: pathName || "",
        query: {
          video: isStarting ? true : undefined,
          start: isStarting ? true : undefined,
          callId: isStarting ? uuidv4() : undefined
        }
      },
      { skipNull: true }
    );
  };

  const doNavigate = (url: string) => {
    startTransition(() => {
      router.push(url);
      router.refresh();
    });
  };

  const onClick = async () => {
    const isStarting = !isVideo;

    // If ending the call, never require a PIN — just navigate away.
    if (!isStarting) {
      doNavigate(buildCallUrl());
      return;
    }

    // If starting a call on a locked chat, require PIN verification first.
    if (isLocked && chatId) {
      const url = buildCallUrl();
      onOpen("callPinVerify", {
        chatId,
        chatName: "video", // used by modal to show Video icon
        // Use window.location.assign — guaranteed to work from a modal closure
        onSuccessCallback: () => { window.location.assign(url); },
      });
      return;
    }

    doNavigate(buildCallUrl());
  };

  return (
    <ActionTooltip side="bottom" label={tooltipLabel}>
      <button
        onClick={onClick}
        disabled={isPending || !supported}
        className="hover:opacity-75 transition mr-4 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Icon className="h-6 w-6 text-zinc-500 dark:text-zinc-400" />
      </button>
    </ActionTooltip>
  );
}
