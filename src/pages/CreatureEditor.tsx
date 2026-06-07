import { invoke } from "@tauri-apps/api/core";
import { SearchIcon, SlidersHorizontalIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Sprite } from "@/components/Sprite";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type Creature, loadCreatures, populationWithDraft } from "@/lib/creature";
import { useCreatureDraft } from "@/lib/useCreatureDraft";
import { cn } from "@/lib/utils";
import type { AbilityOption } from "./creature-editor/AbilityPicker";
import { CreatureDetailsDialog } from "./creature-editor/CreatureDetailsDialog";
import { CreatureForm } from "./creature-editor/CreatureForm";

type Ability = { id: string; name: string };

export default function CreatureEditor() {
  const [creatures, setCreatures] = useState<Creature[] | null>(null);
  const [abilities, setAbilities] = useState<AbilityOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadCreatures(), invoke<Ability[]>("get_abilities")])
      .then(([loaded, abil]) => {
        if (cancelled) return;
        setCreatures(loaded);
        setAbilities(abil.map((a) => ({ id: a.id, name: a.name })));
        if (loaded.length > 0) {
          setSelectedId(loaded[0].id);
        }
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  const saved = useMemo(
    () => creatures?.find((c) => c.id === selectedId) ?? null,
    [creatures, selectedId],
  );

  // Advance the baseline (our creature list) to the just-saved draft so `saved`
  // follows and `dirty` clears. The draft is un-normalized; the persisted
  // normalization (stripped zero gains) rides along inside `saveCreature`.
  const onSaved = useCallback((savedDraft: Creature) => {
    setCreatures((prev) => prev?.map((c) => (c.id === savedDraft.id ? savedDraft : c)) ?? prev);
  }, []);

  const { draft, setDraft, dirty, saving, saveError, save, revert } = useCreatureDraft(
    saved,
    onSaved,
  );

  // The chart's average/max should reflect in-progress edits to the selected
  // creature, so swap the live draft into the population.
  const population = useMemo(() => populationWithDraft(creatures ?? [], draft), [creatures, draft]);

  const filtered = useMemo(() => {
    if (!creatures) return [];
    const q = query.trim().toLowerCase();
    return q
      ? creatures.filter((c) => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q))
      : creatures;
  }, [creatures, query]);

  function select(creature: Creature) {
    // Re-selecting the already-selected creature discards edits (the id is
    // unchanged, so the hook won't re-seed on its own) — preserve that.
    if (creature.id === selectedId) revert();
    else setSelectedId(creature.id);
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-destructive text-sm">
        Failed to load creatures: {error}
      </div>
    );
  }

  if (!creatures) {
    return <div className="p-4 text-muted-foreground text-sm">Loading creatures…</div>;
  }

  return (
    <div className="flex h-full min-h-0 gap-4">
      {/* Creature list */}
      <aside className="flex w-64 shrink-0 flex-col gap-2">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="Filter creatures…"
            className="pl-8"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border p-1">
          {filtered.length === 0 ? (
            <p className="p-2 text-muted-foreground text-sm">No creatures match “{query}”.</p>
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => select(c)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                  c.id === selectedId ? "bg-muted font-medium" : "hover:bg-muted/50",
                )}
              >
                <Sprite name={c.sprite} className="size-6" />
                <span className="flex-1 truncate">{c.name}</span>
                {c.id === selectedId && dirty && (
                  <span
                    className="size-1.5 shrink-0 rounded-full bg-primary"
                    title="Unsaved changes"
                  />
                )}
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Editor */}
      <div className="flex min-w-0 flex-1 flex-col">
        {draft ? (
          <>
            <div className="flex items-center gap-3 border-b pb-3">
              <Sprite name={draft.sprite} className="size-9" />
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-semibold text-lg leading-tight">{draft.name}</h2>
                <p className="truncate text-muted-foreground text-xs">{draft.id}</p>
              </div>
              {saveError && <span className="text-destructive text-sm">{saveError}</span>}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setDetailsOpen(true)}
                title="Edit name, sprite, script & description"
                aria-label="Creature details"
              >
                <SlidersHorizontalIcon className="size-4" />
              </Button>
              <Button variant="outline" disabled={!dirty || saving} onClick={revert}>
                Revert
              </Button>
              <Button disabled={!dirty || saving} onClick={() => void save().catch(() => {})}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-1 py-4">
              <CreatureForm
                creature={draft}
                population={population}
                abilityOptions={abilities}
                onChange={setDraft}
                disabled={saving}
              />
            </div>
            <CreatureDetailsDialog
              creature={draft}
              onChange={setDraft}
              open={detailsOpen}
              onOpenChange={setDetailsOpen}
              disabled={saving}
            />
          </>
        ) : (
          <div className="grid flex-1 place-items-center text-muted-foreground text-sm">
            Select a creature to edit.
          </div>
        )}
      </div>
    </div>
  );
}
