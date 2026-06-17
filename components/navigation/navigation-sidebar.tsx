import React from "react";
import { redirect } from "next/navigation";

import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";

import { NavigationLauncher } from "@/components/navigation/navigation-launcher";
import { NavigationHome } from "@/components/navigation/navigation-home";
import { NavigationMedia } from "@/components/navigation/navigation-media";
import { NavigationNetwork } from "@/components/navigation/navigation-network";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { NavigationUserControl } from "@/components/navigation/navigation-user-control";

export async function NavigationSidebar() {
  const profile = await currentProfile();

  if (!profile) return redirect("/sign-in");

  // Servers are no longer displayed in the far-left sidebar

  return (
    <div className="flex h-full w-full flex-col items-center justify-between overflow-hidden py-2 text-primary dark:bg-[#1e1f22] bg-[#e3e5e8]">
      <ScrollArea className="flex-1 w-full">
        <div className="flex flex-col items-center gap-y-4 py-4 w-full">
          <NavigationLauncher />
          <Separator className="h-[2px] bg-zinc-300 dark:bg-zinc-700 rounded-md w-10 mx-auto shrink-0" />
          <NavigationHome />
          <NavigationMedia />
          <NavigationNetwork />
        </div>
      </ScrollArea>
      <NavigationUserControl userName={profile.name} />
    </div>
  );
}
