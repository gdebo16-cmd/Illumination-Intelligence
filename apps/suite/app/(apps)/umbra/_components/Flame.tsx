'use client';

import { useState } from 'react';
import { flameAnimation, flameAspect, flameColor, flameStill, flameTint, hasAnimation, hasDanceClip } from '@/config/umbra';

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
