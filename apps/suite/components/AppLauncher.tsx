'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { APPS } from '@/config/apps';
import HomeIconPicker from './HomeIconPicker';

const NineDots = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
    {[3, 10, 17].flatMap((y) => [3, 10, 17].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="2" />))}
  </svg>
);

// placement 'up' opens the app grid above the button, for when it sits at the bottom of the screen.
// dock pins it to the bottom-left corner, for pages with no message box to sit beside.
// Pages whose message box has its own switcher: Lumen, a Flicker's chat, and a team's chat.
const hasMessageBar = (path: string) =>
  path === '/lumen' ||
  path.startsWith('/lumen/') ||
  /^\/umbra\/teams\/(?!new$)[^/]+$/.test(path) ||
  /^\/umbra\/(?!new$|inbox$|teams$)[^/]+$/.test(path);

const AppLauncher = ({ placement = 'down', dock = false }: { placement?: 'down' | 'up'; dock?: boolean }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  // The pinned (dock) switcher is drawn straight into the page body, so nothing in the header can
  // clip or hide it. That can only happen in the browser, after the page has loaded.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const launcher = (
    <div className={`app-launcher${placement === 'up' ? ' app-launcher--up' : ''}${dock ? ' app-launcher--dock' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="app-launcher-button"
        aria-label="Switch app"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <NineDots />
      </button>

      {open && (
        <div className="app-launcher-panel">
          <nav className="app-launcher-grid" aria-label="Illumination Intelligence apps">
            {APPS.map((app) => {
              const current = pathname === app.href || pathname.startsWith(`${app.href}/`);
              return (
                <Link
                  key={app.id}
                  href={app.href}
                  className="app-launcher-tile"
                  aria-current={current ? 'page' : undefined}
                  onClick={() => setOpen(false)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- small static icon, no optimisation needed */}
                  <img className="app-launcher-icon" src={app.icon} alt="" width={44} height={44} />
                  <span className="app-launcher-name">{app.name}</span>
                  {app.status === 'soon' && <span className="app-launcher-badge">Soon</span>}
                </Link>
              );
            })}
          </nav>
          <HomeIconPicker />
        </div>
      )}
    </div>
  );

  if (!dock) return launcher;
  // Chat pages already show the switcher beside their message box, so the pinned one stays away.
  if (hasMessageBar(pathname)) return null;
  return mounted ? createPortal(launcher, document.body) : null;
};

export default AppLauncher;
