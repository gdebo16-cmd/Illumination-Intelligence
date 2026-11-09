'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { APPS } from '@/config/apps';

const NineDots = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
    {[3, 10, 17].flatMap((y) => [3, 10, 17].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="2" />))}
  </svg>
);

const AppLauncher = () => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

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

  return (
    <div className="app-launcher" ref={rootRef}>
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
        <nav className="app-launcher-panel" aria-label="Illumination Intelligence apps">
          {APPS.map((app) => {
            const current = pathname === app.href || pathname.startsWith(`${app.href}/`);
            return (
              <Link
                key={app.id}
                href={app.href}
                className="app-launcher-tile"
                aria-current={current ? 'page' : undefined}
                style={{ '--app-color': app.color } as React.CSSProperties}
                onClick={() => setOpen(false)}
              >
                <span className="app-launcher-icon">{app.name[0]}</span>
                <span className="app-launcher-name">{app.name}</span>
                {app.status === 'soon' && <span className="app-launcher-badge">Soon</span>}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
};

export default AppLauncher;
