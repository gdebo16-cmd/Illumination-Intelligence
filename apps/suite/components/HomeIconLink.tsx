'use client';

import { homeIconUrl, useHomeIcon } from '@/hooks/use-home-icon';

// Tells iPhone Safari which picture to use for "Add to Home Screen".
// React moves this <link> into the page's <head>; it updates as soon as a new icon is picked.
export default function HomeIconLink() {
  const icon = useHomeIcon();
  return <link rel="apple-touch-icon" sizes="180x180" href={homeIconUrl(icon)} />;
}
