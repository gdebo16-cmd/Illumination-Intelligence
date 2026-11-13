import type { ReactNode } from 'react';
import AppHeader from './AppHeader';
import Sidebar from './Sidebar';
import SidebarToggle from './SidebarToggle';
import type { SidebarState } from '@/hooks/use-sidebar';

// The frame every app's page sits in: the optional side panel, then the header and the page.
// An app with a panel keeps its state with useSidebar() (it often needs it, e.g. to close the
// panel on a phone after you pick something) and passes it in with what goes inside:
//
//   const panel = useSidebar();
//   <AppShell appId="astra" sidebar={{ panel, title: 'Fonts', label: 'font list', content: <FontList /> }}>
//     <main className="astra">…</main>
//   </AppShell>
//
// `overlays` go after the page, outside it (dialogs that cover everything).

export interface ShellSidebar {
  panel: SidebarState;
  /** The panel's heading, e.g. "Fonts". */
  title: string;
  /** What the panel holds, for the ☰ button's screen-reader label, e.g. "font list". */
  label: string;
  /** An extra class for one app's own touches, e.g. "astra-sidebar". */
  className?: string;
  content: ReactNode;
}

export default function AppShell({
  appId,
  sidebar,
  launcher = true,
  overlays,
  children,
}: {
  appId: string;
  sidebar?: ShellSidebar;
  /** false where the app switcher sits elsewhere (Lumen keeps it beside the message box). */
  launcher?: boolean;
  overlays?: ReactNode;
  children: ReactNode;
}) {
  const open = sidebar?.panel.open ?? false;
  return (
    <div className={`site-container ${open ? 'sidebar-open' : ''}`}>
      {sidebar && (
        <Sidebar open={open} onClose={sidebar.panel.close} title={sidebar.title} className={sidebar.className}>
          {sidebar.content}
        </Sidebar>
      )}
      <div className="content-area">
        <AppHeader
          appId={appId}
          launcher={launcher}
          left={sidebar && <SidebarToggle open={open} onToggle={sidebar.panel.toggle} label={sidebar.label} />}
        />
        {children}
      </div>
      {overlays}
    </div>
  );
}
