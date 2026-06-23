import React from "react";
import { redirect } from "next/navigation";

import { currentProfile } from "@/lib/current-profile";
import { NavigationSidebar } from "@/components/navigation/navigation-sidebar";
import { UnifiedChatSidebar } from "@/components/navigation/unified-chat-sidebar";
import { ChatResizableLayout } from "@/components/navigation/chat-resizable-layout";
import { ensureProfileWorkspace } from "@/lib/profile-workspace";

export default async function MainLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const profile = await currentProfile();

  if (!profile) {
    return redirect("/sign-in");
  }

  await ensureProfileWorkspace(profile);

  return (
    <ChatResizableLayout
      navigation={<NavigationSidebar />}
      sidebar={<UnifiedChatSidebar />}
    >
      {children}
    </ChatResizableLayout>
  );
}
