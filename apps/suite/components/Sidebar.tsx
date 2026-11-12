'use client';

import type { ReactNode } from 'react';

// The slide-out side panel, shared by every app that wants one (Lumen and Prism so far).
//
// This is only the frame: the panel, its title, the ✕ button, and the dimmed backdrop that
// closes it on a phone. Each app puts its own things inside it, between the tags:
//
//   <Sidebar open={open} onClose={close} title="Chats">
//     ...buttons, lists, pickers...
//   </Sidebar>
//
// The app also keeps track of whether it's open (see hooks/use-toggle.tsx) and adds the class
// "sidebar-open" to its "site-container" so the page shifts over on a wide screen.
// The ☰ button that opens it is components/SidebarToggle.tsx. The look is in app/globals.css
// under "Sidebar Styles".
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
