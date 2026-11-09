'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { themeFor } from '@/lib/theme';

// Keeps data-theme on <html> matching the app you are in, and switches it when you move to
// another app with the nine-dot launcher. The colors themselves live in app/theme.css.
export default function ThemeSync() {
  const pathname = usePathname();
  useEffect(() => {
    document.documentElement.dataset.theme = themeFor(pathname);
  }, [pathname]);
  return null;
}
