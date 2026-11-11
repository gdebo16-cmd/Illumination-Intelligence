'use client';

import { useEffect } from 'react';

// Only does anything inside the native iPhone app (apps/ios-shell). There the Capacitor bridge
// adds window.Capacitor and its plugins to the page, so nothing is imported here and the web
// app, the Home Screen app and server rendering are unaffected.
type CapPlugin = Record<string, ((opts?: unknown) => Promise<unknown>) | undefined>;
type CapGlobal = { isNativePlatform?: () => boolean; Plugins?: Record<string, CapPlugin | undefined> };

export default function NativeShell() {
  useEffect(() => {
    const cap = (window as unknown as { Capacitor?: CapGlobal }).Capacitor;
    if (!cap?.isNativePlatform?.()) return;
    // Lets globals.css match the Home Screen app's status-bar spacing.
    document.documentElement.classList.add('cap-native');
    const ignore = () => {};
    // Hide the bar with the up/down arrows and the checkmark above the keyboard.
    cap.Plugins?.Keyboard?.setAccessoryBarVisible?.({ isVisible: false })?.catch(ignore);
    // Transparent status bar over the page with light text, like black-translucent.
    cap.Plugins?.StatusBar?.setOverlaysWebView?.({ overlay: true })?.catch(ignore);
    cap.Plugins?.StatusBar?.setStyle?.({ style: 'DARK' })?.catch(ignore);
  }, []);
  return null;
}
