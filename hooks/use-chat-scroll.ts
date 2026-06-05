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

    if (bottomDiv) {
      if (!hasInitialized) setHasInitialized(true);
      bottomDiv.scrollIntoView({ behavior: hasInitialized ? "smooth" : "auto", block: "end" });
    }
  }, [bottomRef, chatRef, count, hasInitialized]);
};
