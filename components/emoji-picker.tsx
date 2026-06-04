"use client";

import React from "react";
import { Smile } from "lucide-react";
import Picker from "@emoji-mart/react";
import data from "@emoji-mart/data";
import { useTheme } from "next-themes";

import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";

interface EmojiPickerProps {
  onChange: (value: string) => void;
}

export function EmojiPicker({ onChange }: EmojiPickerProps) {
  const { resolvedTheme } = useTheme();
  const [open, setOpen] = React.useState(false);

  const selectEmoji = (emoji: any) => {
    if (emoji?.native) onChange(emoji.native);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Open emoji picker"
          className="flex h-12 w-12 items-center justify-center rounded-full text-zinc-500 transition active:bg-zinc-300/70 dark:text-zinc-300 dark:active:bg-zinc-600/80"
          style={{ touchAction: "manipulation" }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Smile className="h-6 w-6" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="z-[1000] w-[min(360px,calc(100vw-24px))] max-h-[360px] overflow-hidden border-none bg-transparent p-0 shadow-none drop-shadow-none"
        sideOffset={12}
        side="top"
        align="end"
        onPointerDown={(event) => event.stopPropagation()}
        style={{ touchAction: "manipulation" }}
      >
        <Picker
          theme={resolvedTheme}
          data={data}
          previewPosition="none"
          skinTonePosition="none"
          onEmojiSelect={selectEmoji}
        />
      </PopoverContent>
    </Popover>
  );
}
