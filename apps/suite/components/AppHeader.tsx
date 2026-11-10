import type { ReactNode } from 'react';
import AppBanner from './AppBanner';
import AppLauncher from './AppLauncher';

// The banner header used by every app except Lumen (which adds its chat-list button).
// `left` is an optional button on the left; the nine-dot launcher is always on the right.
const AppHeader = ({ appId, left }: { appId: string; left?: ReactNode }) => (
  <header>
    <AppBanner appId={appId} />
    {left ?? <span className="header-spacer" />}
    <AppLauncher />
  </header>
);

export default AppHeader;
