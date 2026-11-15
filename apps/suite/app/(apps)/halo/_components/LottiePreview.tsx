"use client";

// Plays a Lottie animation, using the same player (lottie-web) that websites and apps use, so what
// you see here is what you'll get. Starts over whenever the animation changes.

import { useEffect, useRef } from "react";

export default function LottiePreview({ animation }: { animation: object }) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    let player: { destroy: () => void } | null = null;
    // The player needs the browser, so it's loaded here rather than at the top of the file.
    void import("lottie-web").then(({ default: lottie }) => {
      if (!live || !box.current) return;
      player = lottie.loadAnimation({
        container: box.current,
        renderer: "svg",
        loop: true,
        autoplay: true,
        animationData: structuredClone(animation), // the player writes into what it's given
      });
    });
    return () => {
      live = false;
      player?.destroy();
    };
  }, [animation]);

  return <div ref={box} className="halo-preview" aria-label="Animation preview" role="img" />;
}
