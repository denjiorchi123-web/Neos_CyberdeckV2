import React from "react";
import { redirect } from "next/navigation";

import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";

import { NavigationLauncher } from "@/components/navigation/navigation-launcher";
import { NavigationHome } from "@/components/navigation/navigation-home";
import { NavigationUsb } from "@/components/navigation/navigation-usb";
import { NavigationMedia } from "@/components/navigation/navigation-media";
import { NavigationLogs } from "@/components/navigation/navigation-logs";
import { NavigationNetwork } from "@/components/navigation/navigation-network";
import { NavigationFileManager } from "@/components/navigation/navigation-filemanager";
import { Separator } from "@/components/ui/separator";
import { NavigationUserControl } from "@/components/navigation/navigation-user-control";

export async function NavigationSidebar() {
  const profile = await currentProfile();

  if (!profile) return redirect("/sign-in");

  // Servers are no longer displayed in the far-left sidebar

  return (
    <div className="flex flex-col h-full items-center text-primary w-full dark:bg-[#1e1f22] bg-[#e3e5e8] overflow-hidden">
      <div className="touch-scroll touch-scroll-rail flex flex-1 min-h-0 w-full flex-col items-center gap-y-1 py-1 overflow-y-auto">
        <NavigationLauncher />
        <Separator className="h-[2px] bg-zinc-300 dark:bg-zinc-700 rounded-md w-10 mx-auto" />
        <NavigationHome />
        <Separator className="h-[2px] bg-zinc-300 dark:bg-zinc-700 rounded-md w-10 mx-auto" />
        <NavigationUsb />
        <NavigationMedia />
        <NavigationLogs />
        <NavigationNetwork />
        <NavigationFileManager />
      </div>
      <NavigationUserControl userName={profile.name} />
    </div>
  );
}
