'use client';

import { useEffect } from 'react';

// iOS Safari does not shrink 100dvh when the on-screen keyboard opens. It slides the page up
// instead, which pushes the header off screen and can hide the chat input.
// This keeps --app-height equal to the part of the screen you can actually see, and undoes
// Safari's page scroll, so the layout sits neatly above the keyboard.
export default function ViewportSync() {
  useEffect(() => {
    const vv = window.visualViewport;
    // Only phones and tablets have an on-screen keyboard. On desktop, page scrollbars change the
    // visible height too, and reacting to that made the layout jump back and forth.
    if (!vv || !window.matchMedia('(pointer: coarse)').matches) return;
    const root = document.documentElement;

    const update = () => {
      // While pinch-zoomed the visible area is smaller on purpose; leave the layout alone.
      if (Math.abs(vv.scale - 1) > 0.01) return;
      root.style.setProperty('--app-height', `${Math.round(vv.height)}px`);
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return null;
}
