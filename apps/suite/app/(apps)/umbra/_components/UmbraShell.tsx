'use client';

// Umbra's frame: the banner header and the side panel (components/AppShell.tsx).
//
// What's in the panel depends on the page, so each page says what it wants with useUmbraSidebar():
//
//   useUmbraSidebar(bot && {
//     title: bot.name,
//     items: [
//       { label: 'Tasks', href: `/umbra/${bot.id}/tasks` },
//       { label: 'Clear', onClick: clearChat, disabled: messages.length === 0 },
//     ],
//   });
//
// A page that asks for nothing (or null, e.g. while it's still loading) gets no panel and no ☰ button.

import Link from 'next/link';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import AppShell from '@/components/AppShell';
import useSidebar from '@/hooks/use-sidebar';

export interface UmbraSideItem {
  label: string;
  /** A page to go to… */
  href?: string;
  /** …or something to do here (e.g. clear the chat). */
  onClick?: () => void;
  disabled?: boolean;
  /** A small count beside the label, e.g. unread reports. */
  badge?: number;
}

export interface UmbraSidebar {
  /** The panel's heading, e.g. the Flicker's name. */
  title: string;
  items: UmbraSideItem[];
}

const SetSidebar = createContext<(sidebar: UmbraSidebar | null) => void>(() => {});

export default function UmbraShell({ children }: { children: ReactNode }) {
  const panel = useSidebar();
  const [sidebar, setSidebar] = useState<UmbraSidebar | null>(null);

  const content = sidebar && (
    <nav className="umbra-side-nav" aria-label={sidebar.title}>
      {sidebar.items.map((item) =>
        item.href && !item.disabled ? (
          <Link key={item.label} href={item.href} className="umbra-side-link" onClick={panel.closeOnPhone}>
            <span>{item.label}</span>
            {item.badge ? <span className="umbra-badge">{item.badge}</span> : null}
          </Link>
        ) : (
          <button
            key={item.label}
            type="button"
            className="umbra-side-link"
            disabled={item.disabled}
            onClick={() => {
              item.onClick?.();
              panel.closeOnPhone();
            }}
          >
            <span>{item.label}</span>
            {item.badge ? <span className="umbra-badge">{item.badge}</span> : null}
          </button>
        ),
      )}
    </nav>
  );

  return (
    <SetSidebar.Provider value={setSidebar}>
      <AppShell
        appId="umbra"
        sidebar={sidebar ? { panel, title: sidebar.title, label: 'Umbra menu', className: 'umbra-sidebar', content } : undefined}
      >
        {children}
      </AppShell>
    </SetSidebar.Provider>
  );
}

/** Put these things in Umbra's side panel while this page is open. */
export function useUmbraSidebar(sidebar: UmbraSidebar | null | false | undefined) {
  const set = useContext(SetSidebar);
  // The newest actions, so a button always runs the page's current version (not one from an
  // earlier render with old state in it).
  const latest = useRef(sidebar || null);
  useEffect(() => {
    latest.current = sidebar || null;
  });

  // Only hand the panel a new list when something it shows has changed.
  const shape = sidebar
    ? JSON.stringify([sidebar.title, sidebar.items.map((i) => [i.label, i.href, i.disabled, i.badge, Boolean(i.onClick)])])
    : '';

  useEffect(() => {
    const now = latest.current;
    set(now && {
      title: now.title,
      items: now.items.map((item, index) => ({
        ...item,
        onClick: item.onClick && (() => latest.current?.items[index]?.onClick?.()),
      })),
    });
  }, [shape, set]);

  // Leaving the page takes its things out of the panel.
  useEffect(() => () => set(null), [set]);
}
