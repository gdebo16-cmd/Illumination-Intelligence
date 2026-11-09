import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import HomeIconLink from "@/components/HomeIconLink";
import ViewportSync from "@/components/ViewportSync";
import ThemeSync from "@/components/ThemeSync";
import { THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Illumination Intelligence", template: "%s · Illumination Intelligence" },
  description: "Illumination Intelligence",
  // "Add to Home Screen" on iPhone opens full screen. black-translucent draws the app under
  // the status bar, so the CSS pads the header by env(safe-area-inset-top).
  appleWebApp: { capable: true, title: "Illumination", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  // Older Safari and Chrome tint their bars with this. Same as --edge-color in globals.css.
  themeColor: "#030406",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // Lets the page reach the screen edges on notched iPhones; safe-area padding keeps content clear.
  viewportFit: "cover",
  // Chrome on Android: shrink the layout when the keyboard opens (Safari is handled by ViewportSync).
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="lumen" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <ViewportSync />
        {/* Reads the address, so it waits for it without holding up the rest of the page. */}
        <Suspense fallback={null}>
          <ThemeSync />
        </Suspense>
        <HomeIconLink />
        {children}
      </body>
    </html>
  );
}
