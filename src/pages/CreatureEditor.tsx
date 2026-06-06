import { invoke } from "@tauri-apps/api/core";
import { SearchIcon, SlidersHorizontalIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Sprite } from "@/components/Sprite";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type Creature, loadCreatures, saveCreature } from "@/lib/creature";
import { cn } from "@/lib/utils";
import type { AbilityOption } from "./creature-editor/AbilityPicker";
import { CreatureDetailsDialog } from "./creature-editor/CreatureDetailsDialog";
import { CreatureForm } from "./creature-editor/CreatureForm";

type Ability = { id: string; name: string };

function sameCreature(a: Creature, b: Creature): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export default function CreatureEditor() {
  const [creatures, setCreatures] = useState<Creature[] | null>(null);
  const [abilities, setAbilities] = useState<AbilityOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Creature | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
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
          setDraft(loaded[0]);
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
  const dirty = !!draft && !!saved && !sameCreature(draft, saved);

  // The chart's average/max should reflect in-progress edits to the selected
  // creature, so swap the live draft into the population.
  const population = useMemo(() => {
    if (!creatures) return [];
    if (!draft) return creatures;
    return creatures.map((c) => (c.id === draft.id ? draft : c));
  }, [creatures, draft]);

  const filtered = useMemo(() => {
    if (!creatures) return [];
    const q = query.trim().toLowerCase();
    return q
      ? creatures.filter((c) => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q))
      : creatures;
  }, [creatures, query]);

  function select(creature: Creature) {
    setSelectedId(creature.id);
    setDraft(creature);
    setSaveError(null);
  }

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveCreature(draft);
      // Reflect the persisted normalization (stripped zero gains) locally.
      setCreatures((prev) => prev?.map((c) => (c.id === draft.id ? draft : c)) ?? prev);
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
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
              <Button
                variant="outline"
                disabled={!dirty || saving}
                onClick={() => saved && select(saved)}
              >
                Revert
              </Button>
              <Button disabled={!dirty || saving} onClick={handleSave}>
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
