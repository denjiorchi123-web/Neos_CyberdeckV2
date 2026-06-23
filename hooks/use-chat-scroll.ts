import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";

type ChatScrollProps = {
  chatRef: React.RefObject<HTMLDivElement>;
  bottomRef: React.RefObject<HTMLDivElement>;
  shouldLoadMore: boolean;
  loadMore: () => void;
  count: number;
  isLoadingMore?: boolean;
  scrollKey: string;
};

export const useChatScroll = ({
  chatRef,
  bottomRef,
  shouldLoadMore,
  loadMore,
  count,
  isLoadingMore = false,
  scrollKey,
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
    const topDiv = chatRef?.current;
    if (!topDiv) return;
    topDiv.scrollTo({
      top: topDiv.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
  }, [chatRef]);

  useLayoutEffect(() => {
    hasInitialized.current = false;
    pendingHistoryLoad.current = false;
    previousCount.current = 0;
    previousScrollHeight.current = 0;
    setIsScrolledUp(false);
  }, [scrollKey]);

  useLayoutEffect(() => {
    const bottomDiv = bottomRef?.current;
    const topDiv = chatRef?.current;

    if (!topDiv || count === 0) return;

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
      if (!hasInitialized.current) {
        // scrollIntoView can move an outer page instead of the chat viewport in
        // Chromium kiosk mode. Set the viewport directly, then repeat after the
        // browser's next layout pass so refresh always opens on the latest item.
        topDiv.scrollTop = topDiv.scrollHeight;
        requestAnimationFrame(() => {
          const viewport = chatRef.current;
          if (viewport) viewport.scrollTop = viewport.scrollHeight;
        });
        setIsScrolledUp(false);
      } else if (!isScrolledUp && didAddMessages) {
        topDiv.scrollTo({ top: topDiv.scrollHeight, behavior: "smooth" });
      }
      hasInitialized.current = true;
      previousCount.current = count;
    }
  }, [bottomRef, chatRef, count, isScrolledUp, scrollKey]);

  return { isScrolledUp, scrollToBottom };
};
