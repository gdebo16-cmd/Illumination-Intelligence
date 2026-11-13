// The products in Illumination Intelligence. The nine-dot launcher shows this list in order.
// To add a product: add an entry here and a folder at app/(apps)/<id>/page.tsx, then put its
// banner at public/brand/<id>.png and its icon at public/brand/icons/<id>.png.
// If a product moves to its own server later, set href to its full URL.

export type AppStatus = 'live' | 'soon';

export interface SuiteApp {
  id: string;
  name: string;
  tagline: string;
  href: string;
  /** Header banner (symbol + name) in public/brand/. */
  banner: string;
  /** Symbol on its own, see-through background, in public/brand/icons/. Shown in the launcher. */
  icon: string;
  /** Accent color for the app's name on its "coming soon" page. */
  color: string;
  status: AppStatus;
}

const app = (id: string, name: string, tagline: string, color: string, status: AppStatus): SuiteApp => ({
  id,
  name,
  tagline,
  href: `/${id}`,
  banner: `/brand/${id}.png`,
  icon: `/brand/icons/${id}.png`,
  color,
  status,
});

export const APPS: readonly SuiteApp[] = [
  app('lumen', 'Lumen', 'AI Assistant', '#7aa2ff', 'live'),
  app('umbra', 'Umbra', 'Agentic Flickers', '#a3394b', 'live'),
  app('prism', 'Prism', 'Imagination Station', '#b07cff', 'live'),
  app('astra', 'Astra', 'Font Forger', '#5ad1c4', 'live'),
  app('refract', 'Refract', 'Virtual Playground', '#5b93e6', 'soon'),
  app('aegis', 'Aegis', 'Digital Guardian', '#8fb8e8', 'soon'),
  app('halo', 'Halo', 'Life Mapping', '#e3b84f', 'soon'),
  app('eclipse', 'Eclipse', 'Data Nexus', '#e0484f', 'soon'),
  

];

export const getApp = (id: string): SuiteApp => {
  const found = APPS.find((a) => a.id === id);
  if (!found) throw new Error(`Unknown app "${id}". Add it to config/apps.ts.`);
  return found;
};
