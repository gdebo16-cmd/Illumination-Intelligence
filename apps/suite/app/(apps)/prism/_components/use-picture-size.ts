import { useEffect, useState } from 'react';

/** Width and height of a preview URL, once the browser has read the file. */
export default function usePictureSize(url: string | null): { width: number; height: number } | null {
  const [size, setSize] = useState<{ url: string; width: number; height: number } | null>(null);
  useEffect(() => {
    if (!url) return;
    const img = new Image();
    let live = true;
    img.onload = () => {
      if (live) setSize({ url, width: img.naturalWidth, height: img.naturalHeight });
    };
    img.src = url;
    return () => {
      live = false;
    };
  }, [url]);
  return url && size?.url === url ? size : null;
}
