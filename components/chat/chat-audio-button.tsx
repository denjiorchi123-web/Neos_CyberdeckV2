"use client";

import React from "react";
import { Phone, PhoneOff } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import qs from "query-string";
import { v4 as uuidv4 } from "uuid";
import { useEffect, useState, useTransition } from "react";

import { ActionTooltip } from "@/components/action-tooltip";
import { isWebRTCSupported } from "@/lib/webrtc-support";
import { useModal } from "@/hooks/use-modal-store";
import { usePreferences } from "@/components/providers/socket-provider";

interface ChatAudioButtonProps {
  chatId?: string;
  name?: string;
  serverId?: string;
  otherMemberId?: string;
  callerMemberId?: string;
  currentProfileName?: string;
}

export function ChatAudioButton({ 
  chatId, 
  name,
  serverId,
  otherMemberId,
  callerMemberId,
  currentProfileName
}: ChatAudioButtonProps) {
  const searchParams = useSearchParams();
  const pathName = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { onOpen } = useModal();
  const { lockedChats } = usePreferences();

  // Scenario #12 — disable the button on browsers without WebRTC instead of letting the
  // user click through to a crash in MediaRoom.
  const [supported, setSupported] = useState(true);
  useEffect(() => { setSupported(isWebRTCSupported()); }, []);

  const isAudio = searchParams?.get("audio") && !searchParams?.get("video");
  const isLocked = chatId ? lockedChats.some((lc: any) => lc.chatId === chatId) : false;

  const Icon = isAudio ? PhoneOff : Phone;
  const tooltipLabel = !supported
    ? "Voice calls not supported in this browser"
    : (isAudio ? "End audio call" : "Start audio call");

  const buildCallUrl = () => {
    const isStarting = !isAudio;
    return qs.stringifyUrl(
      {
        url: pathName || "",
        query: {
          audio: isStarting ? true : undefined,
          video: undefined, // Ensure video is off
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
    const isStarting = !isAudio;

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
        chatName: "audio", // used by modal to show Phone icon
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
        <Icon className="h-5 w-5 text-zinc-500 dark:text-zinc-400" />
      </button>
    </ActionTooltip>
  );
}
