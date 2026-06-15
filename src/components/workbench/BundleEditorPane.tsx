import { invoke } from "@tauri-apps/api/core";
import { CheckIcon, FileWarning, Loader2, PlusIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SpritePicker } from "@/components/data-tables/SpritePicker";
import { Sprite } from "@/components/Sprite";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { type Creature, loadCreatures } from "@/lib/creature";
import { type Bundle, type BundleCreature, loadBundles, saveBundle } from "@/lib/entities/bundles";
import { type AbilityOption, AbilityPicker } from "@/pages/creature-editor/AbilityPicker";
import { StatOverridesGrid } from "./StatOverridesGrid";
import { useSaveTarget } from "./saveBus";

/**
 * The bespoke, full-width DATA editor for a BUNDLE tab. A bundle groups creatures
 * and overrides a handful of their draw-time attributes; this pane authors that.
 *
 * Wiring mirrors {@link CreatureDataPane}/`DataEditor`: load the record + the
 * creature population (for the add picker) + abilities (for the override picker),
 * track a draft vs. baseline, and register ONE "data" target with the per-tab
 * save bus so the shared Save button / ⌘S persist it. Bundles are script-less,
 * so there is no SCRIPT pane — {@link TabWorkspace} renders this full-width.
 */
export interface BundleEditorPaneProps {
  /** Primary key of the bundle being edited. */
  id: string;
}

export function BundleEditorPane({ id }: BundleEditorPaneProps) {
  // Remount on id change so draft/baseline state never leaks across tabs.
  return <BundleEditor key={id} id={id} />;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "notFound" }
  | { kind: "loaded" };

function BundleEditor({ id }: { id: string }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [loaded, setLoaded] = useState<Bundle | null>(null);
  const [draft, setDraft] = useState<Bundle | null>(null);
  const [population, setPopulation] = useState<Creature[]>([]);
  const [abilities, setAbilities] = useState<AbilityOption[]>([]);

  // Portal target for the sprite pickers' popovers so they scroll within this
  // pane rather than overflowing it — same pattern as CreatureIdentityFields.
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    Promise.all([
      loadBundles(),
      loadCreatures(),
      invoke<{ id: string; name: string }[]>("get_abilities"),
    ])
      .then(([bundles, creatures, abil]) => {
        if (cancelled) return;
        const found = bundles.find((b) => b.id === id) ?? null;
        if (!found) {
          setState({ kind: "notFound" });
          return;
        }
        setPopulation(creatures);
        setAbilities(abil.map((a) => ({ id: a.id, name: a.name })));
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
    await saveBundle(current);
    setLoaded(current);
  }, []);

  useSaveTarget({ id: "data", order: 0, dirty, save });

  // Index the population for fast name/lookup in member cards.
  const byId = useMemo(() => new Map(population.map((c) => [c.id, c])), [population]);

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
        <span className="font-medium text-foreground">Could not load this bundle.</span>
        <span className="text-xs">{state.message}</span>
      </PaneStatus>
    );
  }
  if (state.kind === "notFound" || !draft) {
    return (
      <PaneStatus>
        <FileWarning className="size-5 text-amber-500" />
        <span>No bundle found for “{id}”.</span>
      </PaneStatus>
    );
  }

  const setMember = (index: number, next: BundleCreature) => {
    setDraft({
      ...draft,
      creatures: draft.creatures.map((m, i) => (i === index ? next : m)),
    });
  };
  const removeMember = (index: number) => {
    setDraft({ ...draft, creatures: draft.creatures.filter((_, i) => i !== index) });
  };
  const addMember = (creatureId: string) => {
    if (draft.creatures.some((m) => m.id === creatureId)) return;
    setDraft({ ...draft, creatures: [...draft.creatures, { id: creatureId }] });
  };

  const usedIds = new Set(draft.creatures.map((m) => m.id));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      {/* Identity */}
      <section className="flex flex-col gap-3">
        <div>
          <h3 className="font-medium text-sm">Details</h3>
          <p className="text-muted-foreground text-xs">Name, sprite, and description.</p>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bundle-name" className="text-xs">
              Name
            </Label>
            <Input
              id="bundle-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.currentTarget.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bundle-sprite" className="text-xs">
              Sprite
            </Label>
            <SpritePicker
              value={draft.sprite ?? ""}
              container={portalContainer}
              onChange={(name) => setDraft({ ...draft, sprite: name })}
            />
          </div>
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="bundle-description" className="text-xs">
              Description
            </Label>
            <Textarea
              id="bundle-description"
              value={draft.description}
              rows={3}
              onChange={(e) => setDraft({ ...draft, description: e.currentTarget.value })}
            />
          </div>
        </div>
      </section>

      {/* Creatures collection */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-medium text-sm">Creatures</h3>
            <p className="text-muted-foreground text-xs">
              The creatures in this bundle. Override attributes applied when drawn.
            </p>
          </div>
          <AddCreaturePicker
            options={population}
            disabledIds={usedIds}
            onAdd={addMember}
            container={portalContainer}
          />
        </div>

        {draft.creatures.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-6 text-center text-muted-foreground text-sm">
            No creatures yet. Add one above.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {draft.creatures.map((member, index) => (
              <MemberCard
                key={member.id}
                member={member}
                base={byId.get(member.id) ?? null}
                abilities={abilities}
                portalContainer={portalContainer}
                onChange={(next) => setMember(index, next)}
                onRemove={() => removeMember(index)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Portal target for the sprite pickers — see portalContainer above. */}
      <div ref={setPortalContainer} />
    </div>
  );
}

/** One bundle member: the base creature plus its optional draw-time overrides. */
function MemberCard({
  member,
  base,
  abilities,
  portalContainer,
  onChange,
  onRemove,
}: {
  member: BundleCreature;
  base: Creature | null;
  abilities: AbilityOption[];
  portalContainer: HTMLElement | null;
  onChange: (next: BundleCreature) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2">
        <Sprite name={member.spriteOverride || base?.sprite || member.id} className="size-7" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-sm">{base?.name ?? member.id}</div>
          <div className="truncate text-muted-foreground text-xs">{member.id}</div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onRemove}
          aria-label={`Remove ${base?.name ?? member.id}`}
        >
          <XIcon className="size-4" />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Name override</Label>
          <Input
            value={member.nameOverride ?? ""}
            placeholder={base?.name ?? "Base name"}
            onChange={(e) => onChange({ ...member, nameOverride: e.currentTarget.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Sprite override</Label>
          <SpritePicker
            value={member.spriteOverride ?? ""}
            container={portalContainer}
            onChange={(name) => onChange({ ...member, spriteOverride: name })}
          />
        </div>
        <div className="col-span-2 flex flex-col gap-1.5">
          <Label className="text-xs">Description override</Label>
          <Textarea
            value={member.descriptionOverride ?? ""}
            placeholder={base?.description || "Base description"}
            rows={2}
            onChange={(e) => onChange({ ...member, descriptionOverride: e.currentTarget.value })}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Ability overrides</Label>
        <AbilityPicker
          value={member.abilitiesOverride ?? []}
          options={abilities}
          onChange={(next) => onChange({ ...member, abilitiesOverride: next })}
          placeholder="Add ability"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Stat overrides</Label>
        <StatOverridesGrid
          value={member.baseStatsOverrides ?? {}}
          onChange={(next) => onChange({ ...member, baseStatsOverrides: next })}
        />
      </div>
    </div>
  );
}

/** Searchable "Add creature" popover over the live creature population. */
function AddCreaturePicker({
  options,
  disabledIds,
  onAdd,
  container,
}: {
  options: Creature[];
  disabledIds: Set<string>;
  onAdd: (id: string) => void;
  container: HTMLElement | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => o.name.toLowerCase().includes(q) || o.id.toLowerCase().includes(q))
    : options;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <PlusIcon className="size-4" /> Add creature
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1" container={container}>
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="Search creatures…"
          className="mb-1 h-8"
        />
        <div className="max-h-64 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-2 py-1.5 text-muted-foreground text-xs">No matches.</p>
          ) : (
            filtered.map((o) => {
              const added = disabledIds.has(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  disabled={added}
                  onClick={() => {
                    onAdd(o.id);
                    setOpen(false);
                    setQuery("");
                  }}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50"
                >
                  <Sprite name={o.sprite || o.id} className="size-5 shrink-0" />
                  <span className="flex-1 truncate">{o.name}</span>
                  {added && <CheckIcon className="size-3.5 text-muted-foreground" />}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
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

export default BundleEditorPane;
