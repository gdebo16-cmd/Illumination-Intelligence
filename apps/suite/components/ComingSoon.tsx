import { getApp } from '@/config/apps';
import AppShell from './AppShell';

// Placeholder page for a product that has no build yet: its banner on top, its symbol and
// name in the middle, and a line saying it is on the way.
const ComingSoon = ({ appId }: { appId: string }) => {
  const app = getApp(appId);

  return (
    <AppShell appId={appId}>
      <main className="coming-soon">
        {/* eslint-disable-next-line @next/next/no-img-element -- small static icon, no optimisation needed */}
        <img className="coming-soon-icon" src={app.icon} alt="" width={112} height={112} />
        <h1 style={{ color: app.color }}>{app.name}</h1>
        <p>{app.tagline === 'Coming soon' ? 'Coming soon. This app is on the way.' : `${app.tagline} — on the way.`}</p>
      </main>
    </AppShell>
  );
};

export default ComingSoon;
