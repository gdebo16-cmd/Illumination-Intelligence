'use client';

import type { ReactNode } from 'react';

// The slide-out side panel, shared by every app that wants one (Lumen, Prism, Astra, Refract).
//
// This is only the frame: the panel, its title, the ✕ button, and the dimmed backdrop that
// closes it on a phone. Each app puts its own things inside it, between the tags:
//
//   <Sidebar open={open} onClose={close} title="Chats">
//     ...buttons, lists, pickers...
//   </Sidebar>
//
// Apps don't use it directly: components/AppShell.tsx puts it in the page, with the ☰ button
// (components/SidebarToggle.tsx), and hooks/use-sidebar.ts decides when it's open. The look is in
// app/styles/base.css under "Sidebar Styles".
export default function Sidebar({ open, onClose, title, className = '', children }: {
  open: boolean;
  onClose: () => void;
  /** The small heading at the top, e.g. "Chats". */
  title: string;
  /** An extra class for one app's own touches, e.g. "prism-sidebar". */
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className="sidebar-container">
      {open && <div className="sidebar-backdrop" onClick={onClose} />}
      <aside id="app-sidebar" className={`sidebar ${open ? 'open' : ''} ${className}`}>
        <div className="sidebar-top">
          <span className="sidebar-title">{title}</span>
          <button type="button" className="sidebar-close" onClick={onClose} aria-label={`Close ${title.toLowerCase()}`}>✕</button>
        </div>
        {children}
      </aside>
    </div>
  );
}
