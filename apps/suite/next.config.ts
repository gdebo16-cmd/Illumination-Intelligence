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
  cacheComponents: true,
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
