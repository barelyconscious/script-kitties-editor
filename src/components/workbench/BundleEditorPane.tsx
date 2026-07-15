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
import { type Biogram, loadBiograms } from "@/lib/entities/biograms";
import {
  type Bundle,
  type BundleAbility,
  type BundleBiogram,
  type BundleCreature,
  loadBundles,
  saveBundle,
} from "@/lib/entities/bundles";
import { useHistoryState } from "@/lib/useHistoryState";
import { type AbilityOption, AbilityPicker } from "@/pages/creature-editor/AbilityPicker";
import { useAutoSave } from "./autoSave";
import { StatOverridesGrid } from "./StatOverridesGrid";
import { useSaveTarget } from "./saveBus";
import { useUndoTarget } from "./undo";

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

/**
 * The minimal shape the shared {@link AddMemberPicker} and {@link OverrideCard}
 * need from any base entity: an id, a display name, a sprite, and a description
 * (used as the override placeholders). Creatures, abilities, and biograms all
 * satisfy this.
 */
type MemberOption = { id: string; name: string; sprite: string; description: string };

function BundleEditor({ id }: { id: string }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [loaded, setLoaded] = useState<Bundle | null>(null);
  // The draft + its undo history; `setDraft` records edits, `reset` re-seeds.
  const history = useHistoryState<Bundle | null>(null);
  const draft = history.value;
  const setDraft = history.set;
  const reset = history.reset;
  const [population, setPopulation] = useState<Creature[]>([]);
  // Abilities kept with `sprite` so the Abilities section's picker/cards can show
  // icons; the creature ability-override picker only wants `{ id, name }`.
  const [abilities, setAbilities] = useState<MemberOption[]>([]);
  const [biograms, setBiograms] = useState<Biogram[]>([]);

  // Portal target for the sprite pickers' popovers so they scroll within this
  // pane rather than overflowing it — same pattern as CreatureIdentityFields.
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    Promise.all([
      loadBundles(),
      loadCreatures(),
      invoke<{ id: string; name: string; sprite: string; description: string }[]>("get_abilities"),
      loadBiograms(),
    ])
      .then(([bundles, creatures, abil, biog]) => {
        if (cancelled) return;
        const found = bundles.find((b) => b.id === id) ?? null;
        if (!found) {
          setState({ kind: "notFound" });
          return;
        }
        setPopulation(creatures);
        setAbilities(
          abil.map((a) => ({
            id: a.id,
            name: a.name,
            sprite: a.sprite,
            description: a.description,
          })),
        );
        setBiograms(biog);
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
    await saveBundle(current);
    setLoaded(current);
  }, []);

  // Bundles auto-save: the debounced `flush` is what the bus saves (so ⌘S / close
  // run the same guarded write), and it persists on its own as you edit.
  const flush = useAutoSave({ draft, dirty, save });
  useSaveTarget({ id: "data", order: 0, dirty, save: flush, autoSave: true });

  // Undo/redo for the bundle draft (Ctrl+Z), driven from the tab.
  useUndoTarget({
    undo: history.undo,
    redo: history.redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    commit: history.commit,
  });

  // Index each population for fast name/lookup in member cards.
  const byId = useMemo(() => new Map(population.map((c) => [c.id, c])), [population]);
  const abilityById = useMemo(() => new Map(abilities.map((a) => [a.id, a])), [abilities]);
  const biogramById = useMemo(() => new Map(biograms.map((b) => [b.id, b])), [biograms]);

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

  const draftAbilities = draft.abilities ?? [];
  const setAbilityMember = (index: number, next: BundleAbility) => {
    setDraft({
      ...draft,
      abilities: draftAbilities.map((m, i) => (i === index ? next : m)),
    });
  };
  const removeAbilityMember = (index: number) => {
    setDraft({ ...draft, abilities: draftAbilities.filter((_, i) => i !== index) });
  };
  const addAbilityMember = (abilityId: string) => {
    if (draftAbilities.some((m) => m.id === abilityId)) return;
    setDraft({ ...draft, abilities: [...draftAbilities, { id: abilityId }] });
  };
  const usedAbilityIds = new Set(draftAbilities.map((m) => m.id));

  const draftBiograms = draft.biograms ?? [];
  const setBiogramMember = (index: number, next: BundleBiogram) => {
    setDraft({
      ...draft,
      biograms: draftBiograms.map((m, i) => (i === index ? next : m)),
    });
  };
  const removeBiogramMember = (index: number) => {
    setDraft({ ...draft, biograms: draftBiograms.filter((_, i) => i !== index) });
  };
  const addBiogramMember = (biogramId: string) => {
    if (draftBiograms.some((m) => m.id === biogramId)) return;
    setDraft({ ...draft, biograms: [...draftBiograms, { id: biogramId }] });
  };
  const usedBiogramIds = new Set(draftBiograms.map((m) => m.id));

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
          <AddMemberPicker
            label="creature"
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
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(20rem,1fr))]">
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

      {/* Abilities collection */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-medium text-sm">Abilities</h3>
            <p className="text-muted-foreground text-xs">
              The abilities granted by this bundle. Override attributes applied when drawn.
            </p>
          </div>
          <AddMemberPicker
            label="ability"
            options={abilities}
            disabledIds={usedAbilityIds}
            onAdd={addAbilityMember}
            container={portalContainer}
          />
        </div>

        {draftAbilities.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-6 text-center text-muted-foreground text-sm">
            No abilities yet. Add one above.
          </p>
        ) : (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(20rem,1fr))]">
            {draftAbilities.map((member, index) => (
              <OverrideCard
                key={member.id}
                member={member}
                base={abilityById.get(member.id) ?? null}
                portalContainer={portalContainer}
                onChange={(next) => setAbilityMember(index, next)}
                onRemove={() => removeAbilityMember(index)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Biograms collection */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-medium text-sm">Biograms</h3>
            <p className="text-muted-foreground text-xs">
              The biograms granted by this bundle. Override attributes applied when drawn.
            </p>
          </div>
          <AddMemberPicker
            label="biogram"
            options={biograms}
            disabledIds={usedBiogramIds}
            onAdd={addBiogramMember}
            container={portalContainer}
          />
        </div>

        {draftBiograms.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-6 text-center text-muted-foreground text-sm">
            No biograms yet. Add one above.
          </p>
        ) : (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(20rem,1fr))]">
            {draftBiograms.map((member, index) => (
              <OverrideCard
                key={member.id}
                member={member}
                base={biogramById.get(member.id) ?? null}
                portalContainer={portalContainer}
                onChange={(next) => setBiogramMember(index, next)}
                onRemove={() => removeBiogramMember(index)}
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
          value={member.baseStatsOverride ?? {}}
          onChange={(next) => onChange({ ...member, baseStatsOverride: next })}
        />
      </div>
    </div>
  );
}

/**
 * One ability/biogram bundle member: the base entity plus its optional name /
 * sprite / description overrides. Like {@link MemberCard} minus the creature-only
 * ability-override and stat-override rows.
 */
function OverrideCard({
  member,
  base,
  portalContainer,
  onChange,
  onRemove,
}: {
  member: BundleAbility | BundleBiogram;
  base: MemberOption | null;
  portalContainer: HTMLElement | null;
  onChange: (next: BundleAbility) => void;
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
    </div>
  );
}

/**
 * Searchable "Add …" popover over a live entity population. Shared by all three
 * bundle collection sections (creatures / abilities / biograms); `label` is the
 * singular noun used in the trigger ("Add ability") and search placeholder.
 */
function AddMemberPicker({
  label,
  options,
  disabledIds,
  onAdd,
  container,
}: {
  label: string;
  options: MemberOption[];
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
          <PlusIcon className="size-4" /> Add {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1" container={container}>
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder={`Search ${label}s…`}
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
