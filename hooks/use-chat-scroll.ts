import { useEffect, useRef, useState } from "react";

type ChatScrollProps = {
  chatRef: React.RefObject<HTMLDivElement>;
  bottomRef: React.RefObject<HTMLDivElement>;
  shouldLoadMore: boolean;
  loadMore: () => void;
  count: number;
};

export const useChatScroll = ({
  chatRef,
  bottomRef,
  shouldLoadMore,
  loadMore,
  count
}: ChatScrollProps) => {
  const [hasInitialized, setHasInitialized] = useState(false);
  const previousScrollHeight = useRef(0);

  useEffect(() => {
    const topDiv = chatRef?.current;

    const handleScroll = () => {
      const topDiv = chatRef?.current;
      if (!topDiv) return;

      const { scrollTop, scrollHeight } = topDiv;
      const isAtTop = scrollTop <= 100;

      if (isAtTop && shouldLoadMore) {
        previousScrollHeight.current = scrollHeight;
        loadMore();
      }
    };

    topDiv?.addEventListener("scroll", handleScroll);

    return () => topDiv?.removeEventListener("scroll", handleScroll);
  }, [shouldLoadMore, loadMore, chatRef]);

  useEffect(() => {
    const bottomDiv = bottomRef?.current;
    const topDiv = chatRef?.current;

    if (topDiv && previousScrollHeight.current > 0) {
      const heightDelta = topDiv.scrollHeight - previousScrollHeight.current;
      topDiv.scrollTop = heightDelta;
      previousScrollHeight.current = 0;
      return;
    }

    const shouldAutoScroll = () => {
      if (!hasInitialized && bottomDiv) {
        setHasInitialized(true);
        return true;
      }

      if (!topDiv) return false;

      const distanceFromBottom =
        topDiv.scrollHeight - topDiv.scrollTop - topDiv.clientHeight;
      return distanceFromBottom <= 150; // Allow a 150px "snap" zone
    };

    if (shouldAutoScroll()) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [bottomRef, chatRef, count, hasInitialized]);
};
