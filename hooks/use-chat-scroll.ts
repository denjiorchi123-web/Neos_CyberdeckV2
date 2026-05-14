import { useEffect, useState } from "react";

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

  useEffect(() => {
    const topDiv = chatRef?.current;

    const handleScroll = () => {
      const topDiv = chatRef?.current;
      if (!topDiv) return;

      const { scrollTop, scrollHeight, clientHeight } = topDiv;

      // In flex-col-reverse, scrollTop 0 is the bottom (newest).
      // We want to load more when we reach the top (older messages).
      // The "top" is where scrollTop + clientHeight is near scrollHeight.
      const isAtTop = Math.abs(scrollTop) + clientHeight >= scrollHeight - 100;

      if (isAtTop && shouldLoadMore) {
        loadMore();
      }
    };

    topDiv?.addEventListener("scroll", handleScroll);

    return () => topDiv?.removeEventListener("scroll", handleScroll);
  }, [shouldLoadMore, loadMore, chatRef]);

  useEffect(() => {
    const bottomDiv = bottomRef?.current;
    const topDiv = chatRef?.current;
    const shouldAutoScroll = () => {
      if (!hasInitialized && bottomDiv) {
        setHasInitialized(true);
        return true;
      }

      if (!topDiv) return false;

      // In flex-col-reverse, the bottom is where scrollTop is near 0.
      const distanceFromBottom = Math.abs(topDiv.scrollTop);
      return distanceFromBottom <= 150; // Allow a 150px "snap" zone
    };

    if (shouldAutoScroll()) {
      setTimeout(() => {
        bottomRef.current?.scrollIntoView({
          behavior: "smooth"
        });
      }, 100);
    }
  }, [bottomRef, chatRef, count, hasInitialized]);
};
