'use client';

import { useEffect, useRef, useState } from 'react';
import { flameAnimation, flameAspect, flameColor, flameStill, flameTint, haloLook, hasAnimation, hasDanceClip } from '@/config/umbra';

// A Flicker's avatar. `size` is its height in pixels. `flame` is its saved look: a shape and a
// color, such as "star#ff8800" (see config/umbra.ts).
//
// mood="idle" (the default) plays the resting animation; mood="working" is for while its bot is
// thinking or using a tool: it glows and plays the dance clip. Until a dance clip exists for the
// flicker, the resting animation hops and sways instead (the "stand-in", see .flame.is-standin).
//
// still=true shows a picture that doesn't move (lighter, for long lists); working overrides it.
// People who ask their device for less motion always get the still picture, and so does anyone
// whose browser can't load the animation.
export default function Flame({ flame, size = 80, still = false, mood = 'idle', className = '' }: {
  flame: string;
  size?: number;
  still?: boolean;
  mood?: 'idle' | 'working';
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const halo = haloLook(flame);
  if (halo) return <HaloFlame id={halo} color={flameColor(flame)} size={size} still={still} working={mood === 'working'} className={className} />;
  const working = mood === 'working';
  const dancing = working && hasDanceClip(flame);
  // Every look has a resting animation now; hasAnimation guards against a look without one.
  const animated = (working || !still) && !broken && hasAnimation(flame);
  const clip = flameAnimation(flame, dancing ? 'dance' : 'idle');
  const classes = ['flame', working && 'is-working', working && !dancing && 'is-standin', className].filter(Boolean).join(' ');

  // A picked color: the shape's white picture is multiplied by it, so white becomes the color
  // and the grey shading becomes a darker shade of it. The tiny hidden <svg> below is the
  // "recipe" for that; the picture points at it by name.
  const tint = flameTint(flame);
  const tintId = tint && `flame-tint-${tint.slice(1)}`;
  const [r, g, b] = tint ? [1, 3, 5].map((i) => (parseInt(tint.slice(i, i + 2), 16) / 255).toFixed(3)) : [];

  return (
    <picture
      className={classes}
      style={{ height: size, width: Math.round(size * flameAspect(flame)), '--flame-color': flameColor(flame), '--flame-size': `${size}px` } as React.CSSProperties}
    >
      {animated && <source media="(prefers-reduced-motion: reduce)" srcSet={flameStill(flame)} />}
      {animated && <source type="image/avif" srcSet={clip.avif} />}
      <img
        src={animated ? clip.webp : flameStill(flame)}
        alt=""
        aria-hidden
        draggable={false}
        style={tintId ? { filter: `url(#${tintId})` } : undefined}
        onError={() => setBroken(true)}
      />
      {tintId && (
        <svg width="0" height="0" aria-hidden style={{ position: 'absolute' }}>
          <filter id={tintId} colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values={`${r} 0 0 0 0  0 ${g} 0 0 0  0 0 ${b} 0 0  0 0 0 1 0`} />
          </filter>
        </svg>
      )}
    </picture>
  );
}

// Saved Halo animations, loaded once each and shared by every avatar that shows them.
const haloFiles = new Map<string, Promise<object | null>>();
function loadHalo(id: string) {
  let file = haloFiles.get(id);
  if (!file) {
    file = fetch(`/api/umbra/looks/${id}`).then((res) => (res.ok ? res.json() : null)).catch(() => null);
    haloFiles.set(id, file);
  }
  return file;
}

// A Flicker made in Halo: plays its Lottie animation with the same player Halo uses. Still avatars
// (and people who ask for less motion) show its first frame. While its bot works it plays faster,
// and the same glow and hop as the other avatars come from the "flame" classes.
function HaloFlame({ id, color, size, still, working, className }: {
  id: string; color: string; size: number; still: boolean; working: boolean; className: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    let player: { destroy: () => void } | null = null;
    const calm = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const moving = (working || !still) && !calm;
    void Promise.all([loadHalo(id), import('lottie-web')]).then(([data, { default: lottie }]) => {
      if (!live || !box.current || !data) return;
      const anim = lottie.loadAnimation({
        container: box.current,
        renderer: 'svg',
        loop: true,
        autoplay: moving,
        animationData: structuredClone(data), // the player writes into what it's given
      });
      if (!moving) anim.goToAndStop(0, true);
      if (working) anim.setSpeed(1.6);
      player = anim;
    });
    return () => {
      live = false;
      player?.destroy();
    };
  }, [id, still, working]);
  const classes = ['flame', 'is-halo', working && 'is-working', working && 'is-standin', className].filter(Boolean).join(' ');
  return (
    <div
      ref={box}
      className={classes}
      aria-hidden
      style={{ height: size, width: size, '--flame-color': color, '--flame-size': `${size}px` } as React.CSSProperties}
    />
  );
}
