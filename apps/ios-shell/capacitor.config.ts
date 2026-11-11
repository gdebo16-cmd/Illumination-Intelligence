import type { CapacitorConfig } from '@capacitor/cli';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The app runs on the Raider (Next.js with server routes), so the native shell does not bundle
// a static copy of the site. It opens the live server instead, like the Home Screen web app.
//
// Pick the address when you sync or build:
//   ILLUMINATION_APP_URL=https://illumination.shrimp-bitterling.ts.net npx cap sync ios
// Default (app-url.json "default"): the Raider on the home Wi-Fi. Long-term value: the Tailscale
// https name ("tailscale"), which works away from home and needs no plain-http exception.
// scripts/write-app-url.mjs uses the same rule so the offline page's "Try again" goes to the app.
const urls = JSON.parse(readFileSync(join(__dirname, 'app-url.json'), 'utf8')) as { default: string };
const url = (process.env.ILLUMINATION_APP_URL || urls.default).trim().replace(/\/+$/, '');
const plainHttp = url.startsWith('http://');

const config: CapacitorConfig = {
  appId: 'com.gdebo.illumination',
  appName: 'Illumination',
  // Only used for the "can't reach the Raider" page; the real app comes from server.url.
  webDir: 'www',
  server: {
    url,
    // Android-only switch; iOS plain http to the LAN is allowed by NSAllowsLocalNetworking in
    // ios/App/App/Info.plist. Off automatically for an https (Tailscale) address.
    cleartext: plainHttp,
    errorPath: 'offline.html',
  },
  ios: {
    // Matches the page's dark edge colour so there is no white flash while it loads.
    backgroundColor: '#030406',
    // Let the page reach under the status bar and use env(safe-area-inset-*), like
    // viewport-fit=cover + black-translucent in Safari.
    contentInset: 'never',
  },
  plugins: {
    Keyboard: {
      // 'none' keeps Safari's behaviour (the web view stays full height and the keyboard slides
      // over it). The layout is already tuned for that: ViewportSync reads visualViewport and sets
      // --app-height. 'native' would shrink the whole web view instead; try it if inputs ever hide.
      resize: 'none',
      style: 'DARK',
    },
    StatusBar: {
      // Transparent bar drawn over the page, the native version of black-translucent.
      overlaysWebView: true,
      style: 'DARK',
    },
  },
};

export default config;
