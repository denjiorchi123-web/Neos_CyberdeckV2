import React from "react";

import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { User } from "lucide-react";
import { cn } from "@/lib/utils";

interface UserAvatarProps {
  src?: string;
  className?: string;
}

export function UserAvatar({ src, className }: UserAvatarProps) {
  return (
    <Avatar className={cn("h-7 w-7 md:h-10 md:w-10", className)}>
      <AvatarImage src={src} />
      <AvatarFallback className="bg-zinc-800 text-zinc-400">
        <User className="h-1/2 w-1/2" />
      </AvatarFallback>
    </Avatar>
  );
}
