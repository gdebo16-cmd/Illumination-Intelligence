import { flameImage } from '@/config/umbra';

// A flame spirit avatar. `size` is its height in pixels; the width follows the artwork's shape.
// Animated by default; still=true shows the first frame (lighter, for long lists).
export default function Flame({ flame, size = 80, still = false, className = '' }: {
  flame: string;
  size?: number;
  still?: boolean;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- animated WebP; Next's image optimiser would freeze it
    <img
      src={flameImage(flame, !still)}
      alt=""
      aria-hidden
      className={`flame ${className}`}
      style={{ height: size, width: 'auto' }}
      draggable={false}
    />
  );
}
