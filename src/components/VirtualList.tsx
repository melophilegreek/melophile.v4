import { useRef, useState, useEffect, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import { ROW_HEIGHT } from '../types';

const OVERSCAN = 8;

interface Props<T> {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  className?: string;
  /**
   * Per-item pixel height. Optional -- defaults to the fixed ROW_HEIGHT
   * (the original, single-height-list behavior). Pass this when the list
   * mixes row types of different heights, e.g. the "Pinned" section header
   * row alongside regular ROW_HEIGHT song rows.
   */
  getItemHeight?: (item: T, index: number) => number;
}

export interface VirtualListHandle {
  scrollToIndex: (index: number) => void;
  getScrollTop: () => number;
}

// Largest index i (0 <= i <= offsets.length - 2) such that offsets[i] <= y.
// offsets has items.length + 1 entries (a leading 0 and a running total),
// so this returns a valid item index for any y within [0, totalHeight].
function findRowIndex(offsets: number[], y: number): number {
  let lo = 0;
  let hi = offsets.length - 2;
  if (hi < 0) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= y) lo = mid; else hi = mid - 1;
  }
  return lo;
}

function VirtualListInner<T>(
  { items, renderItem, className, getItemHeight }: Props<T>,
  ref: React.Ref<VirtualListHandle>,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setContainerHeight(entries[0].contentRect.height));
    ro.observe(el);
    setContainerHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const handleScroll = useCallback(() => {
    if (containerRef.current) setScrollTop(containerRef.current.scrollTop);
  }, []);

  // Running-total offsets array (length items.length + 1). When every row
  // is the fixed ROW_HEIGHT (no getItemHeight passed) this is just
  // `[0, ROW_HEIGHT, 2*ROW_HEIGHT, ...]`, so behavior for existing callers
  // is unchanged.
  const offsets = useMemo(() => {
    const o = new Array(items.length + 1);
    o[0] = 0;
    for (let i = 0; i < items.length; i++) {
      const h = getItemHeight ? getItemHeight(items[i], i) : ROW_HEIGHT;
      o[i + 1] = o[i] + h;
    }
    return o;
  }, [items, getItemHeight]);

  useImperativeHandle(ref, () => ({
    scrollToIndex(index: number) {
      const el = containerRef.current;
      if (!el) return;
      const clamped = Math.max(0, Math.min(index, offsets.length - 2));
      el.scrollTop = offsets[clamped] ?? 0;
    },
    getScrollTop() { return containerRef.current?.scrollTop ?? 0; },
  }), [offsets]);

  const totalHeight = offsets[offsets.length - 1] ?? 0;
  const startIdx = Math.max(0, findRowIndex(offsets, scrollTop) - OVERSCAN);
  const endIdx = Math.min(items.length, findRowIndex(offsets, scrollTop + containerHeight) + 1 + OVERSCAN);
  const visibleItems = items.slice(startIdx, endIdx);

  return (
    <div ref={containerRef} className={`overflow-y-auto ${className ?? ''}`} onScroll={handleScroll}>
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ position: 'absolute', top: offsets[startIdx] ?? 0, left: 0, right: 0 }}>
          {visibleItems.map((item, i) => {
            const idx = startIdx + i;
            const h = getItemHeight ? getItemHeight(item, idx) : ROW_HEIGHT;
            return (
              <div key={idx} style={{ height: h }}>
                {renderItem(item, idx)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export const VirtualList = forwardRef(VirtualListInner) as <T>(
  props: Props<T> & { ref?: React.Ref<VirtualListHandle> },
) => JSX.Element;
