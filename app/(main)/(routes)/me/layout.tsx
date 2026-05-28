import React from "react";
import { DMListSidebar } from "@/components/me/dm-list-sidebar";

export default async function MeLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="h-full flex flex-col">
      <main className="h-full flex-1">
        {children}
      </main>
    </div>
  );
}
