import Image from 'next/image';
import type { ReactNode } from 'react';
import { getApp } from '@/config/apps';
import AppLauncher from './AppLauncher';

// The banner header used by every app except Lumen (which adds its chat-list button).
// `left` is an optional button on the left; the nine-dot launcher is always on the right.
const AppHeader = ({ appId, left }: { appId: string; left?: ReactNode }) => {
  const app = getApp(appId);
  return (
    <header>
      {app.banner && <Image src={app.banner} alt={app.name} width={3840} height={2160} className="banner" priority />}
      {left ?? <span className="header-spacer" />}
      <AppLauncher />
    </header>
  );
};

export default AppHeader;
