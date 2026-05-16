"use client";

import React from "react";
import { Phone, PhoneOff } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import qs from "query-string";
import { v4 as uuidv4 } from "uuid";
import { useEffect, useState, useTransition } from "react";

import { ActionTooltip } from "@/components/action-tooltip";
import { isWebRTCSupported } from "@/lib/webrtc-support";

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

  // Scenario #12 — disable the button on browsers without WebRTC instead of letting the
  // user click through to a crash in MediaRoom.
  const [supported, setSupported] = useState(true);
  useEffect(() => { setSupported(isWebRTCSupported()); }, []);

  const isAudio = searchParams?.get("audio") && !searchParams?.get("video");

  const Icon = isAudio ? PhoneOff : Phone;
  const tooltipLabel = !supported
    ? "Voice calls not supported in this browser"
    : (isAudio ? "End audio call" : "Start audio call");

  const onClick = async () => {
    const isStarting = !isAudio;

    // Ending the call: MediaRoom's unmount cleanup is the single canonical place that
    // emits call:end (it has the callId + targetUserId needed for per-user routing and
    // for the recipient's dead-call registry). Just navigate; React will unmount it.

    const url = qs.stringifyUrl(
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

    startTransition(() => {
      router.push(url);
      router.refresh();
    });
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
