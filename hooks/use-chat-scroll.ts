import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";

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
  const [isScrolledUp, setIsScrolledUp] = useState(false);

  useEffect(() => {
    const topDiv = chatRef?.current;

    const handleScroll = () => {
      const topDiv = chatRef?.current;
      if (!topDiv) return;

      const { scrollTop, scrollHeight, clientHeight } = topDiv;
      const isAtTop = scrollTop <= 100;

      const distanceFromBottom = Math.round(scrollHeight - scrollTop - clientHeight);
      setIsScrolledUp(distanceFromBottom > 50);

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

  const scrollToBottom = useCallback((smooth = true) => {
    bottomRef?.current?.scrollIntoView({
      behavior: smooth ? "smooth" : "auto",
      block: "end"
    });
  }, [bottomRef]);

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
      // When a new message comes in, if we are scrolled up, do NOT auto-scroll
      // unless it's the initial load.
      if (!hasInitialized.current || !isScrolledUp) {
        bottomDiv.scrollIntoView({
          behavior: hasInitialized.current && didAddMessages ? "smooth" : "auto",
          block: "end"
        });
      }
      hasInitialized.current = true;
      previousCount.current = count;
    }
  }, [bottomRef, chatRef, count, isScrolledUp]);

  return { isScrolledUp, scrollToBottom };
};
