import React from "react";
import { redirect } from "next/navigation";
import { MessageSquare } from "lucide-react";

import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";
import { DMList } from "./dm-list";

export async function DMListSidebar() {
  const profile = await currentProfile();

  if (!profile) return redirect("/sign-in");

  // Get the default server to find members
  const defaultServer = await db.server.findFirst({
    where: { inviteCode: "cyberdeck-default" }
  });

  if (!defaultServer) {
    return (
      <div className="p-4 text-xs text-zinc-500">
        No default server found. Please create one.
      </div>
    );
  }

  // Get all members of the default server (except the current user)
  const members = await db.member.findMany({
    where: {
      serverId: defaultServer.id,
      NOT: {
        profileId: profile.id
      }
    },
    include: {
      profile: true
    },
    orderBy: {
      profile: {
        name: "asc"
      }
    }
  });

  return (
    <div className="flex flex-col h-full text-primary w-full dark:bg-[#2b2d31] bg-[#f2f3f5] border-r border-neutral-200 dark:border-neutral-800">
      <div className="px-3 h-12 flex items-center border-b-2 border-neutral-200 dark:border-neutral-800 shadow-sm">
        <h1 className="text-md font-semibold text-black dark:text-white flex items-center gap-x-2">
          <MessageSquare className="h-5 w-5" />
          Direct Messages
        </h1>
      </div>
      
      <DMList members={members} serverId={defaultServer.id} />

      <div className="p-3 bg-[#1e1f22] text-[10px] text-zinc-500 font-mono text-center">
        CYBERDECK_MESH_ACTIVE
      </div>
    </div>
  );
}
