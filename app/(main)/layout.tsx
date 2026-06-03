import React from "react";
import { redirect } from "next/navigation";

import { currentProfile } from "@/lib/current-profile";
import { NavigationSidebar } from "@/components/navigation/navigation-sidebar";
import { UnifiedChatSidebar } from "@/components/navigation/unified-chat-sidebar";
import { ChatResizableLayout } from "@/components/navigation/chat-resizable-layout";

import { db } from "@/lib/db";

export default async function MainLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const profile = await currentProfile();

  if (!profile) {
    return redirect("/sign-in");
  }

  const defaultServer = await db.server.findFirst({
    where: { inviteCode: "cyberdeck-default" },
    include: { members: { where: { profileId: profile.id } } }
  });

  if (defaultServer && defaultServer.members.length === 0) {
    try {
      await db.member.create({
        data: {
          profileId: profile.id,
          serverId: defaultServer.id,
          role: "GUEST"
        }
      });
    } catch (error: any) {
      if (error?.code === "P2002" || error?.code === "P2003") {
        console.log("[MAIN_LAYOUT] Swallowing concurrent member creation error:", error.code);
      } else {
        throw error;
      }
    }
  }

  return (
    <ChatResizableLayout
      navigation={<NavigationSidebar />}
      sidebar={<UnifiedChatSidebar />}
    >
      {children}
    </ChatResizableLayout>
  );
}
