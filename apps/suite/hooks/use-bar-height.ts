'use client';

import { useEffect, type RefObject } from 'react';

/**
 * On phones the message bar floats over the bottom of the chat, so messages can scroll behind it.
 * This tells the message list how tall the bar is (as the CSS variable --bar-h), so the list can
 * leave that much room at its end and new messages stop just above the bar instead of under it.
 * `ready` is false while the page is still loading and the bar isn't on screen yet.
 */
export function useBarHeight(
  bar: RefObject<HTMLElement | null>,
  list: RefObject<HTMLElement | null>,
  ready = true,
) {
  useEffect(() => {
    const barEl = bar.current;
    const listEl = list.current;
    if (!ready || !barEl || !listEl) return;
    const update = () => listEl.style.setProperty('--bar-h', `${barEl.offsetHeight}px`);
    update();
    const watcher = new ResizeObserver(update); // the bar grows when you type several lines
    watcher.observe(barEl);
    return () => watcher.disconnect();
  }, [bar, list, ready]);
}
