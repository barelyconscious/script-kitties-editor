import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { loadSprite, useSpriteCacheVersion } from "./spriteCache";

export { loadSprite } from "./spriteCache";

/**
 * Resolve a sprite name to its data URL (or `null`), sharing the module-level
 * sprite cache with {@link Sprite}. A `null`/empty name short-circuits to `null`
 * without a fetch. The result arrives asynchronously: the hook returns `null`
 * until the cached promise settles, then the data URL. Stale results from a
 * superseded name are dropped (the effect's cancel guard), so rapid name changes
 * never paint an out-of-date sprite.
 *
 * This is the reuse point for the XGUI preview's textured boxes — it shares the
 * one cache rather than adding a second. Subscribing to the cache version means an
 * external image edit (a `sprites-changed` clear) re-runs the fetch and re-paints.
 */
export function useSprite(name: string | null | undefined): string | null {
  const [src, setSrc] = useState<string | null>(null);
  // A cache clear bumps this, re-running the effect against the now-empty cache.
  const version = useSpriteCacheVersion();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the re-fetch trigger — a clearSpriteCache() bump must re-run this effect so it re-fetches fresh bytes, even though the body doesn't read `version` directly (matches guiComponentCache's `ver`)
  useEffect(() => {
    if (!name) {
      setSrc(null);
      return;
    }
    let cancelled = false;
    setSrc(null);
    loadSprite(name).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [name, version]);
  return src;
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
  // A cache clear (external image edit) bumps this, re-running the fetch below.
  const version = useSpriteCacheVersion();

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the re-fetch trigger — a clearSpriteCache() bump must re-run this effect so it re-fetches fresh bytes, even though the body doesn't read `version` directly (matches guiComponentCache's `ver`)
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
  }, [name, inView, version]);

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
