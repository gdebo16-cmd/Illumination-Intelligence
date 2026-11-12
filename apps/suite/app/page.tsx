import type { Metadata } from 'next';
import Link from 'next/link';
import { APPS } from '@/config/apps';

export const metadata: Metadata = { title: 'Illumination' };

export default function Home() {
  return (
    <main className="landing">
      <h1 className="landing-title">Illumination Intelligence</h1>
      <p className="landing-lead">Your future in the palm of your hand.</p>
      <ul className="landing-grid">
        {APPS.map((app) => (
          <li className="landing-card-item" key={app.id}>

            <Link
              href={app.href}
              className={`landing-card${app.status === 'soon' ? ' is-soon' : ''}`}
              data-app={app.id}
            >
              <img 
              src={app.icon} 
              alt="" 
              className="landing-card-icon" />
                          <h2 className="landing-card-title">{app.name}</h2>
                          <p className="landing-card-tagline">{app.tagline}</p>
                          {app.status === 'soon' && (
                          <span className="landing-card-soon"><em>*Coming soon*</em></span>
                        )}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}