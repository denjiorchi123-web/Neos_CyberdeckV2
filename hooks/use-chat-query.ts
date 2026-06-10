import qs from "query-string";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { useSocket } from "@/components/providers/socket-provider";

interface ChatQueryProps {
  queryKey: string;
  apiUrl: string;
  paramKey: "channelId" | "conversationId" | "broadcastId";
  paramValue: string;
}

export const useChatQuery = ({
  queryKey,
  apiUrl,
  paramKey,
  paramValue
}: ChatQueryProps) => {
  const { isConnected } = useSocket();
  const prevConnected = useRef(false);

  const fetchMessages = async ({ pageParam = undefined }) => {
    const url = qs.stringifyUrl(
      {
        url: apiUrl,
        query: {
          cursor: pageParam,
          [paramKey]: paramValue
        }
      },
      { skipNull: true }
    );

    const res = await fetch(url);
    return res.json();
  };

  const query = useInfiniteQuery({
    queryKey: [queryKey],
    queryFn: fetchMessages,
    getNextPageParam: (lastPage) => lastPage?.nextCursor,
    // Always load from DB on first mount — this is how historical messages
    // appear after a reboot even before any new socket events arrive.
    refetchOnMount: true,
    // When socket re-connects after being down, refetch so DB messages
    // that arrived while offline (synced by mesh) show up immediately.
    refetchOnReconnect: true,
    // When socket is connected, real-time updates arrive via useChatSocket.
    // Only fall back to polling (every 5s) when the socket is offline.
    refetchInterval: isConnected ? false : 5000,
    staleTime: 0,
  });

  // Whenever the socket transitions from disconnected → connected,
  // force a REST refetch so any messages that the mesh synced to the local
  // DB while the socket was down are immediately visible in the UI.
  useEffect(() => {
    if (isConnected && !prevConnected.current) {
      query.refetch();
    }
    prevConnected.current = isConnected;
  }, [isConnected]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    data: query.data,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    status: query.status,
  };
};

