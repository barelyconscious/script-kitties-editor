import { FileWarning, Loader2, MinusIcon, PlusIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SpritePicker } from "@/components/data-tables/SpritePicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { type Bundle, loadBundles } from "@/lib/entities/bundles";
import {
  type DrawRules,
  loadPacks,
  type Pack,
  type PackSlot,
  savePack,
} from "@/lib/entities/packs";
import { useEnumValues } from "@/lib/registry";
import { useHistoryState } from "@/lib/useHistoryState";
import { cn } from "@/lib/utils";
import { useAutoSave } from "./autoSave";
import { useSaveTarget } from "./saveBus";
import { useUndoTarget } from "./undo";

/**
 * The bespoke, full-width DATA editor for a PACK tab. A pack is a card pack whose
 * `slots` each define a weighted draw pool (bundle weights + rarity weights).
 * Rendered as a flexing grid of TCG-style cards, one per slot.
 *
 * Wiring mirrors {@link BundleEditorPane}: load the record + the bundle list (for
 * bundle-weight options) + the Registry rarities (for rarity-weight options),
 * track a draft vs. baseline, and register ONE "data" target with the per-tab
 * save bus. Packs are script-less — {@link TabWorkspace} renders this full-width.
 */
export interface PackEditorPaneProps {
  /** Primary key of the pack being edited. */
  id: string;
}

export function PackEditorPane({ id }: PackEditorPaneProps) {
  // Remount on id change so draft/baseline state never leaks across tabs.
  return <PackEditor key={id} id={id} />;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "notFound" }
  | { kind: "loaded" };

function PackEditor({ id }: { id: string }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [loaded, setLoaded] = useState<Pack | null>(null);
  // The draft + its undo history; `setDraft` records edits, `reset` re-seeds.
  const history = useHistoryState<Pack | null>(null);
  const draft = history.value;
  const setDraft = history.set;
  const reset = history.reset;
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const rarities = useEnumValues("creatureRarities");

  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);

  // Which slot just got inserted (and a monotonic token so re-duplicating the
  // same position still re-triggers the one-shot insert flourish in SlotCard).
  const flashToken = useRef(0);
  const [flash, setFlash] = useState<{ index: number; token: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    Promise.all([loadPacks(), loadBundles()])
      .then(([packs, bundleList]) => {
        if (cancelled) return;
        const found = packs.find((p) => p.id === id) ?? null;
        if (!found) {
          setState({ kind: "notFound" });
          return;
        }
        setBundles(bundleList);
        setLoaded(found);
        reset(found); // seed the draft, dropping any prior history
        setState({ kind: "loaded" });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ kind: "error", message: errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [id, reset]);

  const dirty = state.kind === "loaded" && draft != null && loaded != null && !equal(draft, loaded);

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const save = useCallback(async () => {
    const current = draftRef.current;
    if (!current) return;
    await savePack(current);
    setLoaded(current);
  }, []);

  // Packs auto-save: the debounced `flush` is what the bus saves (so ⌘S / close
  // run the same guarded write), and it persists on its own as you edit.
  const flush = useAutoSave({ draft, dirty, save });
  useSaveTarget({ id: "data", order: 0, dirty, save: flush, autoSave: true });

  // Undo/redo for the pack draft (Ctrl+Z), driven from the tab.
  useUndoTarget({
    undo: history.undo,
    redo: history.redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    commit: history.commit,
  });

  if (state.kind === "loading") {
    return (
      <PaneStatus>
        <Loader2 className="size-4 animate-spin" />
        Loading…
      </PaneStatus>
    );
  }
  if (state.kind === "error") {
    return (
      <PaneStatus>
        <FileWarning className="size-5 text-amber-500" />
        <span className="font-medium text-foreground">Could not load this pack.</span>
        <span className="text-xs">{state.message}</span>
      </PaneStatus>
    );
  }
  if (state.kind === "notFound" || !draft) {
    return (
      <PaneStatus>
        <FileWarning className="size-5 text-amber-500" />
        <span>No pack found for “{id}”.</span>
      </PaneStatus>
    );
  }

  const bundleOptions = bundles.map((b) => ({ value: b.id, label: b.name || b.id }));
  const rarityOptions = rarities.map((r) => ({ value: r, label: r }));
  // Total cards across all slots, counting each stack's size.
  const totalCards = draft.slots.reduce((acc, s) => acc + (s.count ?? 1), 0);
  // Each slot occupies a contiguous run of card positions; numbering is
  // cumulative so a stack of N consumes N numbers and the next slot continues
  // after it (e.g. a ×7 slot is "Slots 1-7", then the next starts at 8).
  let runningStart = 0;
  const slotStarts = draft.slots.map((s) => {
    const start = runningStart + 1;
    runningStart += s.count ?? 1;
    return start;
  });

  const setSlot = (index: number, next: PackSlot) => {
    setDraft({ ...draft, slots: draft.slots.map((s, i) => (i === index ? next : s)) });
  };
  const removeSlot = (index: number) => {
    setDraft({ ...draft, slots: draft.slots.filter((_, i) => i !== index) });
  };
  // "Duplicate" no longer spawns a sibling card — it grows this slot's stack
  // (count), so N identical draws read as one card stacked ×N. Pulse the card on
  // each bump for feedback.
  const bumpCount = (index: number, delta: number) => {
    const slot = draft.slots[index];
    const next = Math.max(1, (slot.count ?? 1) + delta);
    setSlot(index, { ...slot, count: next });
    flashToken.current += 1;
    setFlash({ index, token: flashToken.current });
  };
  const addSlot = () => {
    const empty: PackSlot = { drawRules: { bundles: {}, rarity: {} } };
    setDraft({ ...draft, slots: [...draft.slots, empty] });
    // New slot lands at the end; flag that position for the insert flourish.
    flashToken.current += 1;
    setFlash({ index: draft.slots.length, token: flashToken.current });
  };

  return (
    <div className="flex flex-col gap-8">
      {/* Identity */}
      <section className="flex w-full max-w-4xl flex-col gap-3">
        <div>
          <h3 className="font-medium text-sm">Details</h3>
          <p className="text-muted-foreground text-xs">Name, sprite, and description.</p>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pack-name" className="text-xs">
              Name
            </Label>
            <Input
              id="pack-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.currentTarget.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pack-sprite" className="text-xs">
              Sprite
            </Label>
            <SpritePicker
              value={draft.sprite ?? ""}
              container={portalContainer}
              onChange={(name) => setDraft({ ...draft, sprite: name })}
            />
          </div>
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="pack-description" className="text-xs">
              Description
            </Label>
            <Textarea
              id="pack-description"
              value={draft.description}
              rows={3}
              onChange={(e) => setDraft({ ...draft, description: e.currentTarget.value })}
            />
          </div>
        </div>
      </section>

      {/* Slots grid */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-medium text-sm">
              Slots{" "}
              <span className="font-normal text-muted-foreground tabular-nums">{totalCards}</span>
            </h3>
            <p className="text-muted-foreground text-xs">
              Each slot is one card draw, weighted by bundle and rarity.
            </p>
          </div>
        </div>

        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(20rem,1fr))]">
          {draft.slots.map((slot, index) => (
            <SlotCard
              // biome-ignore lint/suspicious/noArrayIndexKey: slots have no stable id; order is identity.
              key={index}
              startNumber={slotStarts[index]}
              slot={slot}
              bundleOptions={bundleOptions}
              rarityOptions={rarityOptions}
              onChange={(next) => setSlot(index, next)}
              onIncrement={() => bumpCount(index, 1)}
              onDecrement={() => bumpCount(index, -1)}
              onRemove={() => removeSlot(index)}
              flashToken={flash?.index === index ? flash.token : null}
            />
          ))}

          {/* Add-slot tile, sized to match a card. */}
          <button
            type="button"
            onClick={addSlot}
            className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-muted-foreground text-sm transition-colors hover:border-ring hover:text-foreground"
          >
            <PlusIcon className="size-6" />
            Add slot
          </button>
        </div>
      </section>

      {/* Portal target for the sprite picker — see portalContainer above. */}
      <div ref={setPortalContainer} />
    </div>
  );
}

type WeightOption = { value: string; label: string };

/**
 * One TCG-style card editing a single slot's draw rules. A slot can represent a
 * STACK of identical cards (`count`): the +/− stepper grows/shrinks the stack and
 * the card renders layered "behind" sheets when count > 1, so duplicates read as
 * one stacked card rather than many sibling cards.
 */
function SlotCard({
  startNumber,
  slot,
  bundleOptions,
  rarityOptions,
  onChange,
  onIncrement,
  onDecrement,
  onRemove,
  flashToken,
}: {
  /** This slot's first card position (1-based, cumulative across earlier stacks). */
  startNumber: number;
  slot: PackSlot;
  bundleOptions: WeightOption[];
  rarityOptions: WeightOption[];
  onChange: (next: PackSlot) => void;
  onIncrement: () => void;
  onDecrement: () => void;
  onRemove: () => void;
  /** Non-null + changing ⇒ play the insert/bump flourish once. */
  flashToken: number | null;
}) {
  const setRules = (rules: DrawRules) => onChange({ ...slot, drawRules: rules });
  const count = slot.count ?? 1;
  const stacked = count > 1;
  // Label spans the slot's card positions: "Slot 3" alone, "Slots 1-7" stacked.
  const label = stacked ? `Slots ${startNumber}-${startNumber + count - 1}` : `Slot ${startNumber}`;

  // Run the jiggle + streak once whenever an insert/bump targets this card.
  const [animating, setAnimating] = useState(false);
  useEffect(() => {
    if (flashToken == null) return;
    setAnimating(true);
    const timer = setTimeout(() => setAnimating(false), 750);
    return () => clearTimeout(timer);
  }, [flashToken]);

  return (
    // self-start so the grid doesn't stretch this item to the row's tallest card:
    // the card keeps its natural height and the stacked sheet matches it exactly.
    <div className="relative self-start">
      {/* A single sheet peeking out behind the card marks it as a stack —
          shown for any count > 1, never more than one regardless of size. */}
      {stacked && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 translate-x-1.5 translate-y-1.5 rounded-lg border bg-card"
        />
      )}
      <div
        className={cn(
          "relative flex flex-col gap-4 rounded-lg border bg-card p-4",
          animating && "animate-slot-insert",
        )}
      >
        {animating && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg">
            <div className="slot-flash-streak" />
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-sm">{label}</span>
          <div className="flex items-center gap-1">
            {/* Stack stepper: − removes a copy (min 1), + adds one (the old
                "duplicate"); the ×N reads the current stack size. */}
            <div className="flex items-center rounded-md border">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={count <= 1}
                onClick={onDecrement}
                aria-label={`Remove one from ${label} stack`}
                title="Remove from stack"
              >
                <MinusIcon className="size-4" />
              </Button>
              <span className="min-w-7 text-center text-xs tabular-nums">×{count}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={onIncrement}
                aria-label={`Add one to ${label} stack`}
                title="Duplicate (add to stack)"
              >
                <PlusIcon className="size-4" />
              </Button>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                if (window.confirm(`Remove ${label}?`)) onRemove();
              }}
              aria-label={`Remove ${label}`}
              title="Remove slot"
            >
              <XIcon className="size-4" />
            </Button>
          </div>
        </div>

        <WeightDistribution
          label="Bundle weights"
          emptyHint="No bundles. Add one to draw from."
          addLabel="Add bundle"
          options={bundleOptions}
          // The backend omits empty weight maps on save, so a loaded slot may have
          // no `bundles`/`rarity` key — default to {} so the editor never crashes.
          value={slot.drawRules.bundles ?? {}}
          onChange={(bundles) => setRules({ ...slot.drawRules, bundles })}
        />

        <WeightDistribution
          label="Rarity weights"
          emptyHint="No rarities. Add one to weight the draw."
          addLabel="Add rarity"
          options={rarityOptions}
          value={slot.drawRules.rarity ?? {}}
          onChange={(rarity) => setRules({ ...slot.drawRules, rarity })}
        />
      </div>
    </div>
  );
}

/**
 * A weight set that's a probability split meant to add up to 1.00. Renders one
 * INDEPENDENT number field per chosen option — editing one never touches the
 * others, so the user has full control; the Σ readout simply flags when the set
 * doesn't total 1.00. Entered/shown and stored as 0..1 decimals. Used for both
 * the bundle and rarity weights of a slot's draw rules.
 */
function WeightDistribution({
  label,
  emptyHint,
  addLabel,
  options,
  value,
  onChange,
}: {
  label: string;
  emptyHint: string;
  addLabel: string;
  options: WeightOption[];
  value: Record<string, number>;
  onChange: (next: Record<string, number>) => void;
}) {
  const entries = Object.entries(value);
  const used = new Set(entries.map(([k]) => k));
  const available = options.filter((o) => !used.has(o.value));
  const labelOf = (key: string) => options.find((o) => o.value === key)?.label ?? key;
  const sum = entries.reduce((acc, [, v]) => acc + v, 0);
  const sumOk = Math.abs(sum - 1) < 1e-6;

  // Values are plain 0..1 decimals. Each field is independent — no other entries
  // are adjusted.
  const setWeight = (key: string, n: number) =>
    onChange({ ...value, [key]: Number.isNaN(n) ? 0 : Math.min(1, Math.max(0, n)) });
  const rename = (oldKey: string, newKey: string) => {
    const next: Record<string, number> = {};
    for (const [k, v] of entries) next[k === oldKey ? newKey : k] = v;
    onChange(next);
  };
  const remove = (key: string) => {
    const next = { ...value };
    delete next[key];
    onChange(next);
  };
  const add = () => {
    if (available.length > 0) onChange({ ...value, [available[0].value]: 0 });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        {entries.length > 0 && (
          <span
            className={cn(
              "text-xs tabular-nums",
              sumOk ? "text-muted-foreground" : "font-medium text-amber-500",
            )}
            title={sumOk ? undefined : "Weights should add up to 1.00"}
          >
            Σ {sum.toFixed(2)}
          </span>
        )}
      </div>

      {entries.length === 0 && <p className="text-muted-foreground text-xs">{emptyHint}</p>}

      {entries.map(([key, weight]) => (
        <div key={key} className="flex items-center gap-2">
          <Select value={key} onValueChange={(k) => rename(key, k)}>
            <SelectTrigger className="h-9 min-w-0 flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[{ value: key, label: labelOf(key) }, ...available].map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="number"
            inputMode="decimal"
            step="0.01"
            min={0}
            max={1}
            className="h-9 min-w-0 flex-1 tabular-nums"
            value={weight}
            onChange={(e) => setWeight(key, e.currentTarget.valueAsNumber)}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => remove(key)}
            aria-label={`Remove ${labelOf(key)}`}
          >
            <XIcon className="size-4" />
          </Button>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        disabled={available.length === 0}
        onClick={add}
      >
        <PlusIcon className="size-4" /> {addLabel}
      </Button>
    </div>
  );
}

function PaneStatus({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground text-sm">
      {children}
    </div>
  );
}

function equal<T extends object>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}

export default PackEditorPane;
