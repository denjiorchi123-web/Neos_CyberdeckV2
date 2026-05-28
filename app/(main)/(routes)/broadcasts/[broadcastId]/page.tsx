import { currentProfile } from "@/lib/current-profile";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { Rss, Settings } from "lucide-react";
import { BroadcastHeaderAction } from "./broadcast-header-action";
import { ChatMessages } from "@/components/chat/chat-messages";
import { ChatInput } from "@/components/chat/chat-input";

interface BroadcastIdPageProps {
  params: {
    broadcastId: string;
  };
}

export default async function BroadcastIdPage({ params }: BroadcastIdPageProps) {
  const profile = await currentProfile();

  if (!profile) {
    return redirect("/sign-in");
  }

  const broadcast = await db.broadcastChannel.findUnique({
    where: { id: params.broadcastId },
    include: { 
      messages: true, 
      followers: {
        include: { profile: true },
        orderBy: { role: "asc" }
      } 
    }
  });

  if (!broadcast) {
    return redirect("/");
  }

  const role = broadcast.followers.find(f => f.profileId === profile.id)?.role;
  const isAdmin = role === "ADMIN";

  return (
    <div className="bg-white dark:bg-[#313338] flex flex-col h-full">
      <div className="h-12 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between px-4 font-semibold">
        <div className="flex items-center gap-x-2">
          <Rss className="h-5 w-5 text-green-500" />
          {broadcast.name}
        </div>
        {isAdmin && <BroadcastHeaderAction broadcastChannel={broadcast} />}
      </div>
      <div className="flex-1 flex flex-col pt-0">
        <ChatMessages
          member={{ id: profile.id, role } as any} // spoofed member to satisfy prop requirements
          name={broadcast.name}
          chatId={broadcast.id}
          type="broadcast"
          apiUrl="/api/broadcast-messages"
          socketUrl="/api/socket/broadcast-messages"
          socketQuery={{
            broadcastId: broadcast.id,
          }}
          paramKey="broadcastId"
          paramValue={broadcast.id}
        />
        
        {/* Admin input area (only shows if current user is admin) */}
        {isAdmin ? (
          <div className="mb-4 mx-4">
            <ChatInput
              name={broadcast.name}
              type="broadcast"
              apiUrl="/api/socket/broadcast-messages"
              query={{
                broadcastId: broadcast.id,
              }}
            />
          </div>
        ) : (
          <div className="mt-auto border-t border-neutral-200 dark:border-neutral-800 p-4">
            <div className="relative">
              <input 
                disabled
                placeholder={`Only admins can send messages to ${broadcast.name}`}
                className="w-full p-4 bg-zinc-100 dark:bg-zinc-700/50 rounded-lg outline-none text-zinc-500 dark:text-zinc-400 cursor-not-allowed"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
