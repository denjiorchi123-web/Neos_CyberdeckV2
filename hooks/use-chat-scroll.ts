import { useEffect, useLayoutEffect, useRef } from "react";

type ChatScrollProps = {
  chatRef: React.RefObject<HTMLDivElement>;
  bottomRef: React.RefObject<HTMLDivElement>;
  shouldLoadMore: boolean;
  loadMore: () => void;
  count: number;
  isLoadingMore?: boolean;
};

export const useChatScroll = ({
  chatRef,
  bottomRef,
  shouldLoadMore,
  loadMore,
  count,
  isLoadingMore = false
}: ChatScrollProps) => {
  const hasInitialized = useRef(false);
  const pendingHistoryLoad = useRef(false);
  const previousCount = useRef(0);
  const previousScrollHeight = useRef(0);

  useEffect(() => {
    const topDiv = chatRef?.current;

    const handleScroll = () => {
      const topDiv = chatRef?.current;
      if (!topDiv) return;

      const { scrollTop, scrollHeight } = topDiv;
      const isAtTop = scrollTop <= 100;

      if (isAtTop && shouldLoadMore && !pendingHistoryLoad.current) {
        pendingHistoryLoad.current = true;
        previousScrollHeight.current = scrollHeight;
        loadMore();
      }
    };

    topDiv?.addEventListener("scroll", handleScroll);

    return () => topDiv?.removeEventListener("scroll", handleScroll);
  }, [shouldLoadMore, loadMore, chatRef]);

  useEffect(() => {
    if (!isLoadingMore && pendingHistoryLoad.current && previousCount.current === count) {
      pendingHistoryLoad.current = false;
      previousScrollHeight.current = 0;
    }
  }, [count, isLoadingMore]);

  useLayoutEffect(() => {
    const bottomDiv = bottomRef?.current;
    const topDiv = chatRef?.current;

    if (!topDiv) return;

    if (pendingHistoryLoad.current && previousScrollHeight.current > 0) {
      const heightDelta = topDiv.scrollHeight - previousScrollHeight.current;
      topDiv.scrollTop = Math.max(0, heightDelta);
      previousCount.current = count;
      pendingHistoryLoad.current = false;
      previousScrollHeight.current = 0;
      return;
    }

    if (bottomDiv) {
      const didAddMessages = count > previousCount.current;
      bottomDiv.scrollIntoView({
        behavior: hasInitialized.current && didAddMessages ? "smooth" : "auto",
        block: "end"
      });
      hasInitialized.current = true;
      previousCount.current = count;
    }
  }, [bottomRef, chatRef, count]);
};
