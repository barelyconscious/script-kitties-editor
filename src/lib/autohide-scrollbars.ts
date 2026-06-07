// macOS shows overlay scrollbars that stay hidden until you scroll, then fade
// back out. Windows (WebView2) shows them always. This reproduces the macOS
// feel everywhere: a single `is-scrolling` class on <html> drives the CSS
// (see App.css) so every scrollbar reveals together while scrolling and hides
// shortly after the user stops.

const HIDE_DELAY_MS = 900;

let hideTimer: number | undefined;

function handleScroll() {
  document.documentElement.classList.add("is-scrolling");
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    document.documentElement.classList.remove("is-scrolling");
  }, HIDE_DELAY_MS);
}

/**
 * Start revealing scrollbars only while the user is actively scrolling. Safe to
 * call once at startup. Uses capture-phase listening because scroll events from
 * nested scroll containers don't bubble to window.
 */
export function initAutohideScrollbars() {
  window.addEventListener("scroll", handleScroll, { capture: true, passive: true });
}
