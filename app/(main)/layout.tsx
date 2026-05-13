import React from "react";
import { redirect } from "next/navigation";

import { currentProfile } from "@/lib/current-profile";
import { NavigationSidebar } from "@/components/navigation/navigation-sidebar";

export default async function MainLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const profile = await currentProfile();

  if (!profile) {
    return redirect("/sign-in");
  }

  return (
    <div className="h-full">
      <div className="hidden md:flex h-full w-[72px] z-30 flex-col fixed inset-y-0">
        <NavigationSidebar />
      </div>
      <main className="md:pl-[72px] h-full">{children}</main>
    </div>
  );
}
