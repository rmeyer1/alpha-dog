"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export function TableScrollFrame({
  children,
  label,
  minWidth,
}: {
  children: ReactNode;
  label: string;
  minWidth: number;
}) {
  const topScrollerRef = useRef<HTMLDivElement>(null);
  const tableScrollerRef = useRef<HTMLDivElement>(null);
  const isSyncingRef = useRef(false);
  const [contentWidth, setContentWidth] = useState(minWidth);
  const [hasOverflow, setHasOverflow] = useState(false);

  const updateOverflow = useCallback(() => {
    const tableScroller = tableScrollerRef.current;

    if (!tableScroller) {
      return;
    }

    setContentWidth(Math.max(minWidth, tableScroller.scrollWidth));
    setHasOverflow(tableScroller.scrollWidth > tableScroller.clientWidth + 1);
  }, [minWidth]);

  useEffect(() => {
    updateOverflow();

    const tableScroller = tableScrollerRef.current;

    if (!tableScroller || typeof ResizeObserver === "undefined") {
      return;
    }

    const resizeObserver = new ResizeObserver(updateOverflow);
    resizeObserver.observe(tableScroller);

    return () => resizeObserver.disconnect();
  }, [updateOverflow]);

  function syncScroll(source: HTMLDivElement, target: HTMLDivElement | null) {
    if (!target || isSyncingRef.current) {
      return;
    }

    isSyncingRef.current = true;
    target.scrollLeft = source.scrollLeft;
    window.requestAnimationFrame(() => {
      isSyncingRef.current = false;
    });
  }

  return (
    <div className="hidden lg:block">
      <div
        className={`sticky top-0 z-30 border-b border-white/10 bg-[#151718]/95 px-3 py-2 backdrop-blur ${
          hasOverflow ? "block" : "hidden"
        }`}
      >
        <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">
          <span>{label}</span>
        </div>
        <div
          aria-label={`${label} column scroller`}
          className="overflow-x-auto pb-1"
          onScroll={(event) =>
            syncScroll(event.currentTarget, tableScrollerRef.current)
          }
          ref={topScrollerRef}
          role="region"
        >
          <div className="h-1" style={{ width: contentWidth }} />
        </div>
      </div>
      <div
        className="overflow-x-auto"
        onScroll={(event) =>
          syncScroll(event.currentTarget, topScrollerRef.current)
        }
        ref={tableScrollerRef}
      >
        {children}
      </div>
    </div>
  );
}
