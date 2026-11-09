'use client';

import { useSyncExternalStore } from 'react';

// Which logo symbol the iPhone uses when you "Add to Home Screen".
// Stored in a cookie on this device. Icons are made by scripts/make-icons.mjs.

export const HOME_ICONS = [
  { id: 'lumen', name: 'Lumen' },
  { id: 'prism', name: 'Prism' },
  { id: 'umbra', name: 'Umbra' },
  { id: 'eclipse', name: 'Eclipse' },
  { id: 'halo', name: 'Halo' },
] as const;

export type HomeIconId = (typeof HOME_ICONS)[number]['id'];

const COOKIE = 'home-icon';
const DEFAULT: HomeIconId = 'lumen';
const listeners = new Set<() => void>();

const read = (): HomeIconId => {
  const match = document.cookie.match(/(?:^|;\s*)home-icon=([^;]+)/);
  const value = match?.[1];
  return HOME_ICONS.some((i) => i.id === value) ? (value as HomeIconId) : DEFAULT;
};

export const setHomeIcon = (id: HomeIconId) => {
  document.cookie = `${COOKIE}=${id}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  listeners.forEach((l) => l());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const homeIconUrl = (id: HomeIconId, size: 180 | 512 = 180) => `/icons/${id}-${size}.png`;

export const useHomeIcon = () => useSyncExternalStore(subscribe, read, () => DEFAULT);
