import { currentProfile } from "@/lib/current-profile";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { Hash, Settings, Megaphone, Users, ChevronRight } from "lucide-react";
import { CommunityHeaderAction } from "./community-header-action";
import Link from "next/link";

interface CommunityIdPageProps {
  params: {
    communityId: string;
  };
}

export default async function CommunityIdPage({ params }: CommunityIdPageProps) {
  const profile = await currentProfile();

  if (!profile) {
    return redirect("/sign-in");
  }

  const community = await db.community.findUnique({
    where: { id: params.communityId },
    include: { 
      groups: {
        include: {
          channels: { where: { type: "TEXT" }, take: 1 }
        }
      },
      members: {
        include: { profile: true },
        orderBy: { role: "asc" }
      }
    }
  });

  if (!community) {
    return redirect("/");
  }

  const role = community.members.find(m => m.profileId === profile.id)?.role;
  const isAdmin = role === "ADMIN";

  return (
    <div className="bg-white dark:bg-[#313338] flex flex-col h-full">
      <div className="h-12 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between px-4 font-semibold">
        <div className="flex items-center gap-x-2">
          <Hash className="h-5 w-5 text-indigo-500" />
          {community.name}
        </div>
        {isAdmin && <CommunityHeaderAction community={community} />}
      </div>
      <div className="touch-scroll flex-1 overflow-y-auto bg-zinc-50 dark:bg-[#2b2d31] p-4">
        
        {/* Announcements Tile */}
        {community.announcementsChannelId && (
          <div className="mb-6">
            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3 px-2">Community Updates</h3>
            <Link href={`/broadcasts/${community.announcementsChannelId}`} className="flex items-center gap-x-4 bg-white dark:bg-[#313338] p-4 rounded-xl shadow-sm border border-neutral-200 dark:border-neutral-800 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition cursor-pointer group">
              <div className="h-12 w-12 bg-indigo-100 dark:bg-indigo-900/50 rounded-lg flex items-center justify-center shrink-0">
                <Megaphone className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div className="flex-1">
                <h4 className="font-semibold text-zinc-800 dark:text-zinc-200 text-base">Announcements</h4>
                <p className="text-sm text-zinc-500 line-clamp-1">Only admins can send messages here.</p>
              </div>
              <ChevronRight className="h-5 w-5 text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition" />
            </Link>
          </div>
        )}

        {/* Groups List */}
        <div>
          <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3 px-2">Included Groups ({community.groups.length})</h3>
          <div className="space-y-2">
            {community.groups.map(group => {
              const defaultChannel = group.channels[0];
              const targetUrl = defaultChannel ? `/servers/${group.id}/channels/${defaultChannel.id}` : `/servers/${group.id}`;
              
              return (
                <Link key={group.id} href={targetUrl} className="flex items-center gap-x-4 bg-white dark:bg-[#313338] p-4 rounded-xl shadow-sm border border-neutral-200 dark:border-neutral-800 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition cursor-pointer group">
                  <div className="h-12 w-12 bg-zinc-200 dark:bg-zinc-800 rounded-full flex items-center justify-center shrink-0 overflow-hidden relative">
                    {group.imageUrl ? (
                      <img src={group.imageUrl} alt={group.name} className="object-cover w-full h-full" />
                    ) : (
                      <Users className="h-6 w-6 text-zinc-500" />
                    )}
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-zinc-800 dark:text-zinc-200 text-base">{group.name}</h4>
                    <p className="text-sm text-zinc-500 line-clamp-1">Tap to enter group chat</p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition" />
                </Link>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}
