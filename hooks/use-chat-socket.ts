import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Member, Message, Profile } from "@prisma/client";

import { useSocket } from "@/components/providers/socket-provider";

type ChatSocketProps = {
  addKey: string;
  updateKey: string;
  queryKey: string;
};

type MessageWithMemberWithProfile = Message & {
  member: Member & {
    profile: Profile;
  };
};

export const useChatSocket = ({
  addKey,
  updateKey,
  queryKey
}: ChatSocketProps) => {
  const { socket } = useSocket();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!socket) return;

    // Join the specific room for this chat/conversation
    const chatId = addKey.split(":")[1];
    socket.emit("chat:join", chatId);

    // When the socket (re)connects — e.g. after a reboot or network blip —
    // invalidate the query so React Query immediately fetches all historical
    // messages from the REST API.  This surfaces any messages the mesh
    // delivered to the local SQLite DB while the socket was offline.
    const handleConnect = () => {
      socket.emit("chat:join", chatId);
      queryClient.invalidateQueries({ queryKey: [queryKey] });
    };
    socket.on("connect", handleConnect);

    socket.on(updateKey, (message: MessageWithMemberWithProfile) => {
      queryClient.setQueryData([queryKey], (oldData: any) => {
        if (!oldData || !oldData.pages || oldData.pages.length === 0) {
          return oldData;
        }

        const newData = oldData.pages.map((page: any) => {
          return {
            ...page,
            items: page.items.map((item: MessageWithMemberWithProfile) => {
              if (item.id === message.id) {
                return message;
              }
              return item;
            })
          };
        });

        return {
          ...oldData,
          pages: newData
        };
      });
    });

    socket.on(addKey, (message: MessageWithMemberWithProfile) => {
      queryClient.setQueryData([queryKey], (oldData: any) => {
        if (!oldData || !oldData.pages || oldData.pages.length === 0) {
          return {
            pages: [
              {
                items: [message]
              }
            ]
          };
        }

        const newData = [...oldData.pages];

        // DEDUPLICATION: Ensure we don't add the same message twice
        const alreadyExists = newData.some(page =>
          page.items.some((item: any) => item.id === message.id)
        );
        if (alreadyExists) return oldData;

        newData[0] = {
          ...newData[0],
          items: [message, ...newData[0].items]
        };

        return {
          ...oldData,
          pages: newData
        };
      });
    });

    return () => {
      socket.off("connect", handleConnect);
      socket.off(addKey);
      socket.off(updateKey);
    };
  }, [queryClient, addKey, queryKey, socket, updateKey]);
};

