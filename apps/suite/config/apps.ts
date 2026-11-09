// The products in Illumination Intelligence. The nine-dot launcher shows this list in order.
// To add a product: add an entry here and a folder at app/(apps)/<id>/page.tsx.
// If a product moves to its own server later, set href to its full URL.

export type AppStatus = 'live' | 'soon';

export interface SuiteApp {
  id: string;
  name: string;
  tagline: string;
  href: string;
  /** Header banner in public/brand/. Optional: Astra has no art yet. */
  banner?: string;
  /** Accent color for the launcher tile. */
  color: string;
  status: AppStatus;
}

export const APPS: readonly SuiteApp[] = [
  { id: 'lumen', name: 'Lumen', tagline: 'Local chat', href: '/lumen', banner: '/brand/lumen.png', color: '#7aa2ff', status: 'live' },
  { id: 'prism', name: 'Prism', tagline: 'Image studio', href: '/prism', banner: '/brand/prism.png', color: '#b07cff', status: 'live' },
  { id: 'umbra', name: 'Umbra', tagline: 'Agent bots', href: '/umbra', banner: '/brand/umbra.png', color: '#a3394b', status: 'live' },
  { id: 'astra', name: 'Astra', tagline: 'Coming soon', href: '/astra', color: '#5ad1c4', status: 'soon' },
  { id: 'eclipse', name: 'Eclipse', tagline: 'Coming soon', href: '/eclipse', banner: '/brand/eclipse.png', color: '#e0484f', status: 'soon' },
  { id: 'halo', name: 'Halo', tagline: 'Coming soon', href: '/halo', banner: '/brand/halo.png', color: '#e3b84f', status: 'soon' },
];

export const getApp = (id: string): SuiteApp => {
  const app = APPS.find((a) => a.id === id);
  if (!app) throw new Error(`Unknown app "${id}". Add it to config/apps.ts.`);
  return app;
};
