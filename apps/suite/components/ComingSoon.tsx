import { getApp } from '@/config/apps';
import AppHeader from './AppHeader';

// Placeholder page for a product that has no build yet.
const ComingSoon = ({ appId }: { appId: string }) => {
  const app = getApp(appId);

  return (
    <div className="site-container">
      <div className="content-area">
        <AppHeader appId={appId} />
        <main className="coming-soon">
          <h1 style={{ color: app.color }}>{app.name}</h1>
          <p>{app.tagline === 'Coming soon' ? 'This app is on the way.' : `${app.tagline} — on the way.`}</p>
        </main>
      </div>
    </div>
  );
};

export default ComingSoon;
