import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Module-level cache so the same sprite isn't fetched once per row. Keyed by
// sprite name; the value is the in-flight (or settled) promise of its data URL
// (null = no art). Cleared wholesale when the install path changes is not yet
// wired here — a future config-change event could call spriteCache.clear().
const spriteCache = new Map<string, Promise<string | null>>();

function loadSprite(name: string): Promise<string | null> {
  let pending = spriteCache.get(name);
  if (!pending) {
    pending = invoke<string | null>("get_sprite", { name }).catch(() => null);
    spriteCache.set(name, pending);
  }
  return pending;
}

export function Sprite({
  name,
  className,
  alt,
  lazy,
}: {
  name: string;
  className?: string;
  alt?: string;
  /** Defer fetching until scrolled into view — for large grids (sprite picker). */
  lazy?: boolean;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [inView, setInView] = useState(!lazy);
  const placeholderRef = useRef<HTMLDivElement | null>(null);

  // Flip `inView` once the placeholder scrolls near the viewport.
  useEffect(() => {
    if (inView) return;
    const el = placeholderRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          obs.disconnect();
        }
      },
      { rootMargin: "100px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [inView]);

  useEffect(() => {
    if (!inView) return;
    let cancelled = false;
    setSrc(null);
    loadSprite(name).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [name, inView]);

  if (!src) {
    // Placeholder for art that's missing, still loading, or not yet in view.
    return (
      <div
        ref={placeholderRef}
        className={cn(
          "shrink-0 rounded-sm border border-muted-foreground/30 border-dashed bg-muted/40",
          className,
        )}
        aria-hidden="true"
      />
    );
  }

  return (
    <img
      src={src}
      alt={alt ?? name}
      className={cn("shrink-0 [image-rendering:pixelated]", className)}
    />
  );
}

export default Sprite;
