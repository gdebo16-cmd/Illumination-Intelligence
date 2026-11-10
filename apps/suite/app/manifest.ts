import type { MetadataRoute } from 'next';

// Tells iPhone that the whole site is one app. Without this, iOS guesses the app's scope from
// the page you were on when you tapped "Add to Home Screen" (usually /lumen/...), and any other
// app (/umbra, /prism, ...) opens in Safari's overlay with the X button and address bar.
// After changing this file, delete the home-screen icon and add it again: iOS saves the
// manifest when the app is installed.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Illumination Intelligence',
    short_name: 'Illumination',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#030406',
    theme_color: '#030406',
    icons: [
      { src: '/icons/lumen-180.png', sizes: '180x180', type: 'image/png' },
      { src: '/icons/lumen-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
