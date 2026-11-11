'use client';

import { useState } from 'react';
import { FLAME_ASPECT, flameAnimation, flameColor, flameStill, hasDanceClip } from '@/config/umbra';

// A flame spirit avatar. `size` is its height in pixels.
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
  const working = mood === 'working';
  const dancing = working && hasDanceClip(flame);
  const animated = (working || !still) && !broken;
  const clip = flameAnimation(flame, dancing ? 'dance' : 'idle');
  const classes = ['flame', working && 'is-working', working && !dancing && 'is-standin', className].filter(Boolean).join(' ');

  return (
    <picture
      className={classes}
      style={{ height: size, width: Math.round(size * FLAME_ASPECT), '--flame-color': flameColor(flame), '--flame-size': `${size}px` } as React.CSSProperties}
    >
      {animated && <source media="(prefers-reduced-motion: reduce)" srcSet={flameStill(flame)} />}
      {animated && <source type="image/avif" srcSet={clip.avif} />}
      <img src={animated ? clip.webp : flameStill(flame)} alt="" aria-hidden draggable={false} onError={() => setBroken(true)} />
    </picture>
  );
}
