/**
 * ConflictDialog — the save-time "this file changed on disk" prompt. When a
 * Workbench save detects the backing file's mtime moved since it was loaded, the
 * saving code calls {@link useConflictPrompt}`()(label)` and awaits the user's
 * choice: Reload from disk (discard local edits), Overwrite (clobber disk), or
 * Cancel (keep editing, don't save).
 *
 * Exposed as an IMPERATIVE promise so a target's `save` can `await` a decision
 * inline. One dialog per tab (mounted by {@link import("./TabWorkspace")}); since
 * only the active tab saves at a time, a single pending prompt is all that's ever
 * needed. Dismissing (overlay/Esc) resolves as Cancel — the safe default.
 */

import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ConflictChoice } from "./diskGuard";

type PromptFn = (label: string) => Promise<ConflictChoice>;

const ConflictPromptContext = createContext<PromptFn | null>(null);

/**
 * Returns a function that opens the disk-change prompt for `label` and resolves
 * with the user's choice. Outside a provider it resolves to `"overwrite"` (the
 * pre-guard behavior) so a stray caller never deadlocks.
 */
export function useConflictPrompt(): PromptFn {
  return useContext(ConflictPromptContext) ?? (async () => "overwrite");
}

type Pending = { label: string; resolve: (choice: ConflictChoice) => void };

export function ConflictDialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  // Guard against a resolve firing twice (button click AND the dismiss handler).
  const resolvedRef = useRef(false);

  const prompt = useCallback<PromptFn>((label) => {
    return new Promise<ConflictChoice>((resolve) => {
      resolvedRef.current = false;
      setPending({ label, resolve });
    });
  }, []);

  const finish = useCallback(
    (choice: ConflictChoice) => {
      if (resolvedRef.current) return;
      resolvedRef.current = true;
      pending?.resolve(choice);
      setPending(null);
    },
    [pending],
  );

  return (
    <ConflictPromptContext.Provider value={prompt}>
      {children}
      <Dialog
        open={pending !== null}
        onOpenChange={(next) => {
          if (!next) finish("cancel");
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Changed on disk</DialogTitle>
            <DialogDescription>
              {pending ? (
                <>
                  <span className="font-mono text-foreground">{pending.label}</span> was modified on
                  disk since you opened it. Reload the new version (losing your edits), or overwrite
                  it with yours?
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => finish("cancel")}>
              Cancel
            </Button>
            <Button variant="outline" onClick={() => finish("reload")}>
              Reload from disk
            </Button>
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => finish("overwrite")}
            >
              Overwrite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConflictPromptContext.Provider>
  );
}
