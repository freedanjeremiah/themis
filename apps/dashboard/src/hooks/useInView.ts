"use client";
import { useEffect, useRef, useState } from "react";

/** Reveal-on-scroll. Returns a ref and whether it has entered the viewport. */
export function useInView<T extends HTMLElement>(opts?: { once?: boolean; rootMargin?: string; threshold?: number }) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") { setInView(true); return; }
    const once = opts?.once ?? true;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setInView(true);
          if (once) io.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { rootMargin: opts?.rootMargin ?? "0px 0px -12% 0px", threshold: opts?.threshold ?? 0.2 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [opts?.once, opts?.rootMargin, opts?.threshold]);

  return { ref, inView };
}
