'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';

// Whether an app's side panel (components/Sidebar.tsx) is open. Every app with one uses this, so
// they all behave the same:
//   - On a wide screen (a computer, or a tablet on its side) it starts open; on a phone, closed,
//     because there it slides over the page.
//   - Until you open or close it yourself, it follows the screen width as the window is resized.
//     After that, your choice sticks.
//   - closeOnPhone() is for picking something in the panel (a chat, a picture): on a phone the
//     panel gets out of the way so you can see it; on a wide screen it stays.

const WIDE_SCREEN = '(min-width: 1024px)';
const PHONE_WIDTH = 768;

const watchWide = (onChange: () => void) => {
  const query = window.matchMedia(WIDE_SCREEN);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
const isWideNow = () => window.matchMedia(WIDE_SCREEN).matches;
const isWideOnServer = () => false; // the server can't see the window; the browser corrects it

export interface SidebarState {
  open: boolean;
  toggle: () => void;
  close: () => void;
  /** Close it on a phone only (after picking something in it). */
  closeOnPhone: () => void;
}

export default function useSidebar(): SidebarState {
  const isWide = useSyncExternalStore(watchWide, isWideNow, isWideOnServer);
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = choice ?? isWide;
  const toggle = useCallback(() => setChoice(!open), [open]);
  const close = useCallback(() => setChoice(false), []);
  const closeOnPhone = useCallback(() => {
    if (window.innerWidth < PHONE_WIDTH) setChoice(false);
  }, []);
  return { open, toggle, close, closeOnPhone };
}
