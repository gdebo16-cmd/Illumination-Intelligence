import type { ReactNode } from 'react';
import AppBanner from './AppBanner';
import AppLauncher from './AppLauncher';

// The banner header every app uses (through components/AppShell.tsx). `left` is an optional button
// on the left, e.g. the side panel's ☰. The nine-dot app switcher sits at the bottom of the screen,
// pinned to the bottom-left corner; `launcher={false}` leaves it out for an app that puts it
// somewhere else (Lumen has it beside the message box).
const AppHeader = ({ appId, left, launcher = true }: { appId: string; left?: ReactNode; launcher?: boolean }) => (
  <header>
    <AppBanner appId={appId} />
    {left ?? <span className="header-spacer" />}
    <span className="header-spacer" />
    {launcher && <AppLauncher placement="up" dock />}
  </header>
);

export default AppHeader;
