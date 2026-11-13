import { useEffect, useState } from 'react';

/** Tailwind's `lg` breakpoint: where a page has room for a list and a reader side by side. */
const WIDE = '(min-width: 1024px)';

/** Whether the screen is wide enough for side-by-side panes; follows resizing. */
export function useWideScreen(): boolean {
  const query = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(WIDE).matches;
  const [wide, setWide] = useState(query);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(WIDE);
    const onChange = () => setWide(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return wide;
}
