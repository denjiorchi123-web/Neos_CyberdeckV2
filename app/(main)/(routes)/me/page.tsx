import React from "react";
import { MessageCircle } from "lucide-react";

export default function MePage() {
  return (
    <div className="h-full flex flex-col items-center justify-center bg-white dark:bg-[#313338]">
      <div className="flex flex-col items-center justify-center text-center max-w-md">
        <div className="h-40 w-40 mb-8 rounded-full bg-indigo-100 dark:bg-indigo-900/20 flex items-center justify-center">
          <MessageCircle className="h-20 w-20 text-indigo-500" />
        </div>
        <h2 className="text-2xl font-light text-zinc-700 dark:text-zinc-300 mb-2">
          CyberDeck OS
        </h2>
        <p className="text-zinc-500 dark:text-zinc-400 text-sm">
          Send and receive messages securely on the air-gapped network.
          Select a chat from the sidebar or start a new group.
        </p>
      </div>
    </div>
  );
}
