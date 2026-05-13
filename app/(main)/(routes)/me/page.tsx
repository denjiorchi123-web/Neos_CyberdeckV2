import React from "react";
import { MessageSquare, Phone, Video, Clock } from "lucide-react";
import { format } from "date-fns";

import { currentProfile } from "@/lib/current-profile";
import { db } from "@/lib/db";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

export default async function MePage() {
  const profile = await currentProfile();
  
  if (!profile) return null;

  // Fetch recent call history for this profile
  const callHistory = await (db as any).callHistory.findMany({
    where: {
      OR: [
        { callerId: profile.id },
        { calleeId: profile.id },
        { channelId: { contains: "user" } } // DM calls
      ]
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 10
  });

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#313338]">
      <div className="flex flex-col flex-1 p-6">
        <div className="flex items-center gap-x-3 mb-8">
          <div className="p-3 bg-indigo-500 rounded-xl">
            <MessageSquare className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-black dark:text-white">
              Profile History
            </h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Your recent secure communications on the CyberDeck mesh.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Recent Activity / Stats */}
          <div className="bg-zinc-100 dark:bg-[#2b2d31] rounded-2xl p-6 border border-black/5 dark:border-white/5">
            <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-500 mb-4 flex items-center gap-x-2">
              <Clock className="h-4 w-4" />
              Recent Activity
            </h3>
            <div className="flex flex-col gap-y-4">
               <p className="text-sm text-zinc-600 dark:text-zinc-300">
                 You are currently connected as <span className="text-indigo-500 font-bold">{profile.name}</span>. 
                 All your chat history is securely maintained in the local SQLite node.
               </p>
               <Separator className="bg-zinc-200 dark:bg-zinc-700" />
               <div className="flex items-center justify-between">
                 <span className="text-xs text-zinc-500">Node Status</span>
                 <span className="text-xs text-emerald-500 font-bold uppercase">Encrypted & Online</span>
               </div>
            </div>
          </div>

          {/* Call Logs */}
          <div className="bg-zinc-100 dark:bg-[#2b2d31] rounded-2xl p-6 border border-black/5 dark:border-white/5 flex flex-col">
            <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-500 mb-4 flex items-center gap-x-2">
              <Video className="h-4 w-4" />
              Call History
            </h3>
            <ScrollArea className="flex-1 max-h-[300px]">
              {callHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 opacity-50">
                  <Phone className="h-8 w-8 mb-2" />
                  <p className="text-xs">No recent calls recorded</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {callHistory.map((call: any) => (
                    <div key={call.id} className="flex items-center justify-between p-3 bg-white/50 dark:bg-black/20 rounded-lg border border-black/5 dark:border-white/5">
                      <div className="flex items-center gap-x-3">
                        {call.type === "video" ? <Video className="h-4 w-4 text-indigo-500" /> : <Phone className="h-4 w-4 text-emerald-500" />}
                        <div>
                          <p className="text-xs font-bold capitalize">
                            {call.type} Call
                          </p>
                          <p className="text-[10px] text-zinc-500">
                            {format(new Date(call.createdAt), "d MMM, HH:mm")}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={cn(
                          "text-[10px] font-bold uppercase",
                          call.status === "missed" ? "text-rose-500" : "text-zinc-500"
                        )}>
                          {call.status}
                        </p>
                        {call.duration > 0 && (
                          <p className="text-[10px] text-zinc-400">
                            {Math.floor(call.duration / 60)}m {call.duration % 60}s
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>
      </div>
    </div>
  );
}

function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(" ");
}
