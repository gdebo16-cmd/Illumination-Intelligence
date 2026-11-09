import { APPS } from '@/config/apps';

// Each app has its own colors in app/theme.css, under [data-theme="<app id>"].
// The first part of the address picks the theme: /umbra/... → "umbra". Anything else → "lumen".
const IDS = APPS.map((a) => a.id);

export function themeFor(pathname: string): string {
  const first = pathname.split('/')[1] ?? '';
  return IDS.includes(first) ? first : 'lumen';
}

// Runs in <head> before the page paints on first load, so you never see a flash of Lumen's colors.
export const THEME_SCRIPT = `(function(){var ids=${JSON.stringify(IDS)};var s=location.pathname.split('/')[1]||'';document.documentElement.dataset.theme=ids.indexOf(s)>=0?s:'lumen';})();`;
