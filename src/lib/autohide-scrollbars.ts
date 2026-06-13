// macOS shows overlay scrollbars that stay hidden until you scroll, then fade
// back out. Windows (WebView2) shows them always. This reproduces the macOS
// feel everywhere: the `is-scrolling` class is toggled on the element that is
// ACTUALLY being scrolled (see App.css) so only that container's scrollbar
// reveals while scrolling, then hides shortly after the user stops.

const HIDE_DELAY_MS = 900;

// Per-element hide timers, keyed by the scrolled element. A WeakMap so detached
// containers don't pin memory; we never iterate it (lookup by element only).
const hideTimers = new WeakMap<Element, number>();

function handleScroll(event: Event) {
  // The scroll target is the scrolled element itself; for document/window
  // scrolls it's the document, whose scrollbar lives on the scrolling element.
  const node = event.target;
  const el = node instanceof Element ? node : document.scrollingElement;
  if (!el) return;

  el.classList.add("is-scrolling");
  window.clearTimeout(hideTimers.get(el));
  hideTimers.set(
    el,
    window.setTimeout(() => {
      el.classList.remove("is-scrolling");
      hideTimers.delete(el);
    }, HIDE_DELAY_MS),
  );
}

/**
 * Start revealing scrollbars only while the user is actively scrolling. Safe to
 * call once at startup. Uses capture-phase listening because scroll events from
 * nested scroll containers don't bubble to window.
 */
export function initAutohideScrollbars() {
  window.addEventListener("scroll", handleScroll, { capture: true, passive: true });
}
