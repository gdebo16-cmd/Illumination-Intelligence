import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Addresses other devices use to reach the dev server: two on the home network, plus this PC's
  // private Tailscale name and IP (so the iPhone can use the app from anywhere).
  allowedDevOrigins: [
    '192.168.1.50',
    '192.168.1.114',
    'illumination.shrimp-bitterling.ts.net',
    '100.98.151.55',
  ],
  // Local pictures may carry a ?v= version so phones fetch a fresh copy after artwork changes.
  images: { localPatterns: [{ pathname: '/**' }] },
  cacheComponents: true,
  // Refract's SSH terminal (lib/refract/terminal.ts) loads these from node_modules at run time.
  serverExternalPackages: ['ssh2', 'ws'],
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
