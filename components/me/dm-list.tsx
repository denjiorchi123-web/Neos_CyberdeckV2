"use client";

import React, { useState } from "react";
import { Search, Users } from "lucide-react";
import { Member, Profile } from "@prisma/client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { DMSidebarItem } from "./dm-sidebar-item";

interface DMListProps {
  members: (Member & { profile: Profile })[];
  serverId: string;
}

export function DMList({ members, serverId }: DMListProps) {
  const [search, setSearch] = useState("");

  const filteredMembers = members.filter((member) => 
    member.profile.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full">
      {/* Search Bar */}
      <div className="px-3 py-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <input 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search contacts..."
            className="w-full bg-[#1e1f22] text-xs text-white pl-9 pr-3 py-2 rounded-md border border-white/5 focus:border-indigo-500/50 outline-none transition"
          />
        </div>
      </div>

      <ScrollArea className="flex-1 px-3">
        <div className="mb-4">
          <div className="flex items-center justify-between py-2 text-zinc-500 hover:text-zinc-600 dark:text-zinc-400 dark:hover:text-zinc-300 transition">
            <p className="text-xs uppercase font-bold tracking-widest flex items-center gap-x-2">
              <Users className="h-3 w-3" />
              Contacts ({filteredMembers.length})
            </p>
          </div>
          <div className="space-y-1">
            {filteredMembers.map((m) => (
              <DMSidebarItem 
                key={m.id}
                member={m}
                serverId={serverId}
              />
            ))}
            {filteredMembers.length === 0 && (
              <p className="text-[10px] text-zinc-500 text-center py-4">
                No contacts found
              </p>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
