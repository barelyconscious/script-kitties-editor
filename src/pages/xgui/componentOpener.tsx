/**
 * ComponentOpener — a tiny shared bridge that lets any region of the XGUI editor
 * open a component through the SAME guarded flow the component list uses (the
 * warn-on-switch prompt when the open component is dirty). The list OWNS that flow
 * (see {@link ComponentList}) and registers a `requestOpenByBasename` here;
 * consumers call `open(basename)` to trigger it. Component basenames are unique
 * tree-wide, so a basename resolves to exactly one component.
 *
 * WHY a context and not props: the component list and the structure tree are
 * SIBLINGS under the page shell, so they can't hand callbacks to each other
 * directly. The provider (mounted in {@link Xgui}) holds the registered opener in a
 * ref and exposes a stable `open` that forwards to it — a no-op until the list
 * registers one, and after the list unmounts. The tree's double-click-to-open on a
 * `<Component>` element is the first consumer.
 */

import { createContext, useContext, useEffect, useMemo, useRef } from "react";

/** Open the component with this basename (extension-less), e.g. "bag_slot". */
type OpenByBasename = (basename: string) => void;

type ComponentOpenerValue = {
  /** Open a component by basename via the list's guarded flow. */
  open: OpenByBasename;
  /** Internal: the component list registers its guarded opener here (null clears). */
  register: (fn: OpenByBasename | null) => void;
};

const ComponentOpenerContext = createContext<ComponentOpenerValue | null>(null);

function noop() {}

export function ComponentOpenerProvider({ children }: { children: React.ReactNode }) {
  // The registered opener lives in a ref so registering it never re-renders
  // consumers; `open` is a stable forwarder read fresh on each call.
  const ref = useRef<OpenByBasename | null>(null);
  const value = useMemo<ComponentOpenerValue>(
    () => ({
      open: (basename) => ref.current?.(basename),
      register: (fn) => {
        ref.current = fn;
      },
    }),
    [],
  );
  return (
    <ComponentOpenerContext.Provider value={value}>{children}</ComponentOpenerContext.Provider>
  );
}

/** Consumer side: returns `open(basename)` — a no-op when no opener is registered. */
export function useComponentOpener(): OpenByBasename {
  const ctx = useContext(ComponentOpenerContext);
  return ctx?.open ?? noop;
}

/** Producer side: registers `fn` as THE opener for as long as the caller is mounted. */
export function useRegisterComponentOpener(fn: OpenByBasename): void {
  const ctx = useContext(ComponentOpenerContext);
  useEffect(() => {
    if (!ctx) return;
    ctx.register(fn);
    return () => ctx.register(null);
  }, [ctx, fn]);
}
