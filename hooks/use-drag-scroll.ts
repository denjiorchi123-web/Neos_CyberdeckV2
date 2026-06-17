import { useRef, useEffect } from 'react';

export function useDragScroll(ref: React.RefObject<HTMLElement>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let isDragging = false;
    let startY = 0;
    let scrollTop = 0;

    const onPointerDown = (e: PointerEvent) => {
      // Only trigger on main click/touch
      if (e.button !== 0 && e.pointerType === 'mouse') return;

      isDragging = true;
      startY = e.pageY;
      scrollTop = el.scrollTop;
      el.style.cursor = 'grabbing';

      // Prevent text selection while dragging
      document.body.style.userSelect = 'none';
      document.body.style.webkitUserSelect = 'none';
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging) return;

      // Calculate how far the pointer moved
      const y = e.pageY;
      const walk = (y - startY) * 1.5; // 1.5x speed multiplier for smoother feel

      el.scrollTop = scrollTop - walk;
    };

    const onPointerUp = () => {
      if (isDragging) {
        isDragging = false;
        el.style.cursor = 'auto';
        document.body.style.userSelect = '';
        document.body.style.webkitUserSelect = '';
      }
    };

    // Attach listeners
    el.addEventListener('pointerdown', onPointerDown);

    // Listen on window for move/up so dragging continues even if pointer leaves the element
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [ref]);
}
