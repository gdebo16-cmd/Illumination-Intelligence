'use client';

import { useCallback, useState } from 'react';

// Whether an app's side panel (components/Sidebar.tsx) is open. Every app with one uses this, so
// they all behave the same:
//   - It starts closed, on every screen. The ☰ button opens and closes it.
//   - closeOnPhone() is for picking something in the panel (a chat, a picture): on a phone, where
//     the panel covers the page, it gets out of the way so you can see what you picked; on a wider
//     screen it stays open.

const PHONE_WIDTH = 768;

export interface SidebarState {
  open: boolean;
  toggle: () => void;
  close: () => void;
  /** Close it on a phone only (after picking something in it). */
  closeOnPhone: () => void;
}

export default function useSidebar(): SidebarState {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  const close = useCallback(() => setOpen(false), []);
  const closeOnPhone = useCallback(() => {
    if (window.innerWidth < PHONE_WIDTH) setOpen(false);
  }, []);
  return { open, toggle, close, closeOnPhone };
}
