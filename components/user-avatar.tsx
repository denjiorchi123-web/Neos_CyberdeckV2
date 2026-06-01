import React from "react";

import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { User } from "lucide-react";
import { cn } from "@/lib/utils";

interface UserAvatarProps {
  src?: string;
  className?: string;
  status?: "online" | "offline" | "idle" | "dnd";
}

export function UserAvatar({ src, className, status }: UserAvatarProps) {
  return (
    <div className="relative inline-block">
      <Avatar className={cn("h-7 w-7 md:h-10 md:w-10", className)}>
        <AvatarImage src={src} />
        <AvatarFallback className="bg-zinc-800 text-zinc-400">
          <User className="h-1/2 w-1/2" />
        </AvatarFallback>
      </Avatar>
      {status && (
        <span
          className={cn(
            "absolute bottom-0 right-0 block h-3 w-3 rounded-full ring-2 ring-white dark:ring-[#2b2d31]",
            status === "online" ? "bg-emerald-500" :
            status === "offline" ? "bg-rose-500" :
            status === "idle" ? "bg-amber-500" : "bg-red-500"
          )}
        />
      )}
    </div>
  );
}
