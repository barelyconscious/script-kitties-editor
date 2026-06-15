import { FileWarning, Loader2, PlusIcon, XIcon } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { useSaveTarget } from "./saveBus";

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
  const [draft, setDraft] = useState<Pack | null>(null);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const rarities = useEnumValues("rarities");

  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);

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
        setDraft(found);
        setState({ kind: "loaded" });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ kind: "error", message: errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const dirty = state.kind === "loaded" && draft != null && loaded != null && !equal(draft, loaded);

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const save = useCallback(async () => {
    const current = draftRef.current;
    if (!current) return;
    await savePack(current);
    setLoaded(current);
  }, []);

  useSaveTarget({ id: "data", order: 0, dirty, save });

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

  const setSlot = (index: number, next: PackSlot) => {
    setDraft({ ...draft, slots: draft.slots.map((s, i) => (i === index ? next : s)) });
  };
  const removeSlot = (index: number) => {
    setDraft({ ...draft, slots: draft.slots.filter((_, i) => i !== index) });
  };
  const addSlot = () => {
    const empty: PackSlot = { drawRules: { bundles: {}, rarity: {} } };
    setDraft({ ...draft, slots: [...draft.slots, empty] });
  };

  return (
    <div className="flex flex-col gap-8">
      {/* Identity */}
      <section className="mx-auto flex w-full max-w-4xl flex-col gap-3">
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
            <h3 className="font-medium text-sm">Slots</h3>
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
              index={index}
              slot={slot}
              bundleOptions={bundleOptions}
              rarityOptions={rarityOptions}
              onChange={(next) => setSlot(index, next)}
              onRemove={() => removeSlot(index)}
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

/** One TCG-style card editing a single slot's draw rules. */
function SlotCard({
  index,
  slot,
  bundleOptions,
  rarityOptions,
  onChange,
  onRemove,
}: {
  index: number;
  slot: PackSlot;
  bundleOptions: WeightOption[];
  rarityOptions: WeightOption[];
  onChange: (next: PackSlot) => void;
  onRemove: () => void;
}) {
  const setRules = (rules: DrawRules) => onChange({ ...slot, drawRules: rules });

  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="font-medium text-sm">Slot {index + 1}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => {
            if (window.confirm(`Remove slot ${index + 1}?`)) onRemove();
          }}
          aria-label={`Remove slot ${index + 1}`}
        >
          <XIcon className="size-4" />
        </Button>
      </div>

      <WeightEditor
        label="Bundle weights"
        emptyHint="No bundles. Add one to draw from."
        addLabel="Add bundle"
        options={bundleOptions}
        // The backend omits empty weight maps on save, so a loaded slot may have
        // no `bundles`/`rarity` key — default to {} so the editor never crashes.
        value={slot.drawRules.bundles ?? {}}
        onChange={(bundles) => setRules({ ...slot.drawRules, bundles })}
      />

      <WeightEditor
        label="Rarity weights"
        emptyHint="No rarities. Add one to weight the draw."
        addLabel="Add rarity"
        options={rarityOptions}
        value={slot.drawRules.rarity ?? {}}
        onChange={(rarity) => setRules({ ...slot.drawRules, rarity })}
        showSum
      />
    </div>
  );
}

/**
 * A list of `{ option → weight }` rows with add/remove. Each row picks a key from
 * `options` (minus ones already used) and sets a numeric (float) weight. Used for
 * both bundle and rarity weights. With `showSum`, a running total is shown with a
 * soft warning when it isn't 1.00 (the design requires rarity weights to sum to 1).
 */
function WeightEditor({
  label,
  emptyHint,
  addLabel,
  options,
  value,
  onChange,
  showSum,
}: {
  label: string;
  emptyHint: string;
  addLabel: string;
  options: WeightOption[];
  value: Record<string, number>;
  onChange: (next: Record<string, number>) => void;
  showSum?: boolean;
}) {
  const entries = Object.entries(value);
  const used = new Set(entries.map(([k]) => k));
  const available = options.filter((o) => !used.has(o.value));
  const labelOf = (key: string) => options.find((o) => o.value === key)?.label ?? key;
  const sum = entries.reduce((acc, [, v]) => acc + v, 0);
  const sumOk = Math.abs(sum - 1) < 1e-6;

  function rename(oldKey: string, newKey: string) {
    const next: Record<string, number> = {};
    for (const [k, v] of entries) next[k === oldKey ? newKey : k] = v;
    onChange(next);
  }
  function setWeight(key: string, n: number) {
    onChange({ ...value, [key]: n });
  }
  function remove(key: string) {
    const next = { ...value };
    delete next[key];
    onChange(next);
  }
  function add() {
    if (available.length === 0) return;
    onChange({ ...value, [available[0].value]: 1 });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        {showSum && entries.length > 0 && (
          <span
            className={cn(
              "text-xs tabular-nums",
              sumOk ? "text-muted-foreground" : "font-medium text-amber-500",
            )}
            title={sumOk ? undefined : "Rarity weights should sum to 1.00"}
          >
            Σ {sum.toFixed(2)}
          </span>
        )}
      </div>

      {entries.length === 0 && <p className="text-muted-foreground text-xs">{emptyHint}</p>}

      {entries.map(([key, weight]) => (
        <div key={key} className="flex items-center gap-2">
          <Select value={key} onValueChange={(k) => rename(key, k)}>
            <SelectTrigger className="flex-1">
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
            step="any"
            min={0}
            className="h-9 w-20 tabular-nums"
            value={weight}
            onChange={(e) => {
              const n = e.currentTarget.valueAsNumber;
              setWeight(key, Number.isNaN(n) ? 0 : n);
            }}
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
