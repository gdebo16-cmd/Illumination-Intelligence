import type { ReactNode } from 'react';
import AppBanner from './AppBanner';
import AppLauncher from './AppLauncher';

// The banner header used by every app except Lumen (which adds its chat-list button).
// `left` is an optional button on the left. The nine-dot app switcher sits at the bottom of the screen:
// beside the message box on chat pages, otherwise pinned to the bottom-left corner.
const AppHeader = ({ appId, left }: { appId: string; left?: ReactNode }) => (
  <header>
    <AppBanner appId={appId} />
    {left ?? <span className="header-spacer" />}
    <span className="header-spacer" />
    <AppLauncher placement="up" dock />
  </header>
);

export default AppHeader;
