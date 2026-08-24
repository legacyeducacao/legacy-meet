import { useEffect, useState } from 'react';

/** true quando o container rolou além do limiar (com histerese anti-flicker). */
export function useCondensedHeader(scrollRef: React.RefObject<HTMLElement | null>, threshold = 24) {
  const [condensed, setCondensed] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const y = el.scrollTop;
      setCondensed((prev) => (prev ? y > threshold - 8 : y > threshold + 8));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [scrollRef, threshold]);
  return condensed;
}
