import React from "react";
import { DMListSidebar } from "@/components/me/dm-list-sidebar";

export default async function MeLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="h-full flex">
      <div className="hidden md:flex h-full w-64 z-20 flex-col fixed inset-y-0 left-[72px]">
        <DMListSidebar />
      </div>
      <main className="h-full flex-1 md:pl-64">
        {children}
      </main>
    </div>
  );
}
