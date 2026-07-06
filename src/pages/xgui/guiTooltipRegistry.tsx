/**
 * guiTooltipRegistry — the editor-side registry that lets the XGUI preview simulate
 * tooltips WITHOUT relying on DOM hover (task 515).
 *
 * WHY A REGISTRY (not DOM hover): grid cells are `pointer-events-none` +
 * `suppressNodeId` (a locked selection decision), so the browser's hover can never
 * reach them — a stamped cell that authors `tooltip=` would be un-hoverable. Instead,
 * EVERY GuiBox whose node carries a non-empty `tooltip` attr REGISTERS itself here on
 * mount (its screen-rect getter + the tooltip `src` + its scope-RESOLVED
 * `tooltipData`), and the preview's single pointermove controller rect-tests the
 * pointer against the registered providers. This mirrors the engine's flat
 * interactive-list insight: resolve interaction from a registry, not the DOM tree.
 *
 * The registry lives in a REF (not React state) owned by GuiPreview and shared via
 * context, so a register/unregister never triggers a re-render. `data` is resolved at
 * registration AGAINST THE BOX'S OWN SCOPE — only the box knows its composite
 * grid-item scope — the same value-boundary pre-resolution a `<Component data=>` mount
 * does; the provider re-registers when that resolved data changes so a Data Model edit
 * never leaves a stale tooltip.
 *
 * Register/unregister are idempotent by `boxKey` (React strict-mode double-invokes an
 * effect: register → cleanup → register nets to one entry). `boxKey` is already unique
 * per stamped cell (`nodeId#index`).
 */

import { createContext, type RefObject, useContext, useEffect, useMemo } from "react";
import { type ResolveScope, resolveWholeTokenValue } from "../../lib/guiBinding";
import type { GuiNode } from "../../lib/guiNode";

/** A registered tooltip provider: how to measure it, plus its tooltip ref + data. */
export type TooltipProviderEntry = {
  /** Live screen-rect getter (the box's `getBoundingClientRect`), or `null` if unmounted. */
  getRect: () => DOMRect | null;
  /** The tooltip component ref (`tooltip=` attr value, e.g. `gui.card.xml`). */
  src: string;
  /** The `tooltipData` RESOLVED against the box's own scope at registration. */
  data: unknown;
};

/** One provider measured at snapshot time: its current screen rect + payload. */
export type TooltipProviderSnapshot = {
  key: string;
  rect: DOMRect;
  src: string;
  data: unknown;
};

/**
 * The per-preview provider registry. Ref-based (no React state): `register`/
 * `unregister` mutate a `Map` so they never re-render. `snapshot` measures every live
 * provider (calling its `getRect`) in registration order, dropping any whose ref has
 * unmounted — the ordered array the pointer controller rect-tests (last match ≈
 * topmost).
 */
export type TooltipRegistry = {
  register(key: string, entry: TooltipProviderEntry): void;
  unregister(key: string): void;
  snapshot(): TooltipProviderSnapshot[];
};

/** Build a fresh registry backed by an insertion-ordered `Map`. */
export function createTooltipRegistry(): TooltipRegistry {
  const providers = new Map<string, TooltipProviderEntry>();
  return {
    register(key, entry) {
      // `Map.set` on an existing key updates the value AND preserves its insertion
      // order — so a re-register (data changed) keeps the provider's paint-order slot.
      providers.set(key, entry);
    },
    unregister(key) {
      providers.delete(key);
    },
    snapshot() {
      const out: TooltipProviderSnapshot[] = [];
      for (const [key, entry] of providers) {
        const rect = entry.getRect();
        if (rect) out.push({ key, rect, src: entry.src, data: entry.data });
      }
      return out;
    },
  };
}

/** Context carrying the open preview's registry to the boxes nested inside it. */
const TooltipRegistryContext = createContext<TooltipRegistry | null>(null);

/** Provider for {@link TooltipRegistryContext} (GuiPreview wraps its box tree in this). */
export const TooltipRegistryProvider = TooltipRegistryContext.Provider;

/** The nearest preview's tooltip registry, or `null` outside a preview. */
export function useTooltipRegistry(): TooltipRegistry | null {
  return useContext(TooltipRegistryContext);
}

/**
 * Register a GuiBox as a tooltip provider WHEN its node carries a non-empty `tooltip`
 * attr — otherwise a no-op. Resolves `tooltipData` against the box's OWN `scope` (the
 * only scope that knows this box's grid-item context) and re-registers whenever that
 * resolved data changes, so the provider's payload never goes stale after a Data Model
 * edit. Registration is idempotent by `boxKey` (strict-mode safe).
 *
 * @param boxKey the box's render-stable identity (unique per stamped grid cell).
 * @param node the box's node (read for `tooltip` / `tooltipData`).
 * @param ref the box's DOM ref (its live screen rect).
 * @param scope the box's resolution scope (for `tooltipData`).
 */
export function useTooltipProvider(
  boxKey: string,
  node: GuiNode,
  ref: RefObject<HTMLDivElement | null>,
  scope: ResolveScope,
): void {
  const registry = useTooltipRegistry();
  const src = node.attrs.tooltip?.trim() ?? "";
  const dataAttr = node.attrs.tooltipData ?? "";
  // Resolve the tooltip data against this box's own scope. Memoized on the raw attr +
  // scope: for a grid cell `scope` is a fresh object each render, so this recomputes,
  // but the RESULT keeps a stable identity while the model is unchanged (it points at
  // the same model/item object) — so the effect below does not re-register spuriously.
  const data = useMemo(
    () => (dataAttr === "" ? undefined : resolveWholeTokenValue(dataAttr, scope)),
    [dataAttr, scope],
  );

  useEffect(() => {
    if (!registry || src === "") return;
    registry.register(boxKey, {
      getRect: () => ref.current?.getBoundingClientRect() ?? null,
      src,
      data,
    });
    return () => registry.unregister(boxKey);
  }, [registry, boxKey, src, data, ref]);
}
