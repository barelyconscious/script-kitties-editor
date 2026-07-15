import { Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type Registry as RegistryData,
  type RegistryEntry,
  type RegistryEnumKey,
  useRegistry,
} from "@/lib/registry";
import RegistryPalette from "./RegistryPalette";

/**
 * The enum sections, in display order, with editor-facing copy. `readOnly`
 * sections are fixed by the game (hardcoded in C++, not tweakable in Lua) — they
 * are shown for reference but can't be edited. Only the tag lists are editable.
 */
const SECTIONS: { key: RegistryEnumKey; title: string; blurb: string; readOnly?: boolean }[] = [
  {
    key: "combatTags",
    title: "Combat Tags",
    blurb: "Shared by abilities, biograms, and effects.",
  },
  { key: "itemTags", title: "Item Tags", blurb: "Available on items." },
  {
    key: "abilityShapes",
    title: "Ability Shapes",
    blurb: "Targeting shapes for abilities. Fixed by the game.",
    readOnly: true,
  },
  {
    key: "rarities",
    title: "Rarities",
    blurb: "Item rarity tiers (low → high). Fixed by the game.",
    readOnly: true,
  },
  {
    key: "creatureRarities",
    title: "Creature Rarities",
    blurb: "Card rarity tiers for gacha draws (low → high).",
  },
  {
    key: "biomes",
    title: "Biomes",
    blurb: "World biomes for item drops. Fixed by the game.",
    readOnly: true,
  },
  {
    key: "damageTypes",
    title: "Damage Types",
    blurb: "Referenced by Lua scripts. Fixed by the game.",
    readOnly: true,
  },
];

/**
 * The Registry tool: edit the tweakable enums (tags, ability shapes, rarities,
 * biomes, damage types) that drive the editor's dropdowns. Values + descriptions
 * are persisted in an editor-owned config file (editor.registry.json) via the
 * backend. Editing here updates every form's dropdown live on save.
 */
export default function Registry() {
  const { registry, loading, save } = useRegistry();
  const [draft, setDraft] = useState<RegistryData>(registry);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Re-seed the draft whenever the loaded registry changes (initial load, or
  // after our own save commits it). In-progress edits are preserved otherwise.
  useEffect(() => {
    setDraft(registry);
  }, [registry]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(registry),
    [draft, registry],
  );

  function setSection(key: RegistryEnumKey, entries: RegistryEntry[]) {
    setStatus(null);
    setDraft((prev) => ({ ...prev, [key]: entries }));
  }

  function firstError(): string | null {
    for (const { key, title } of SECTIONS) {
      const entries = draft[key];
      const values = entries.map((e) => e.value.trim());
      if (values.some((v) => v.length === 0)) return `${title}: a value is empty.`;
      const dupe = values.find((v, i) => values.indexOf(v) !== i);
      if (dupe) return `${title}: "${dupe}" is listed twice.`;
    }
    return null;
  }

  async function handleSave() {
    const err = firstError();
    if (err) {
      setStatus({ ok: false, message: err });
      return;
    }
    // Trim values/descriptions so stray whitespace never reaches the data.
    const cleaned = Object.fromEntries(
      SECTIONS.map(({ key }) => [
        key,
        draft[key].map((e) => ({ value: e.value.trim(), description: e.description.trim() })),
      ]),
    ) as RegistryData;
    setSaving(true);
    try {
      await save(cleaned);
      setStatus({ ok: true, message: "Saved." });
    } catch (e) {
      setStatus({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div>
        <h1 className="font-semibold text-lg">Registry</h1>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto pr-1">
        {/* Region 1 — editor-facing enums; writes editor.registry.json. */}
        <section>
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-base">Editor enums</h2>
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.65rem] text-muted-foreground">
                  editor.registry.json
                </code>
              </div>
              <p className="max-w-prose text-muted-foreground text-sm">
                Values that populate the editor's own dropdowns. Values are written into game data;
                descriptions are notes for you.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {status && (
                <span
                  className={
                    status.ok ? "text-muted-foreground text-sm" : "text-destructive text-sm"
                  }
                >
                  {status.message}
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                disabled={!dirty || saving}
                onClick={() => setDraft(registry)}
              >
                <RotateCcw /> Reset
              </Button>
              <Button size="sm" disabled={!dirty || saving} onClick={() => void handleSave()}>
                <Save /> Save
              </Button>
            </div>
          </div>

          {loading ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {SECTIONS.map(({ key, title, blurb, readOnly }) => (
                <EnumSection
                  key={key}
                  title={title}
                  blurb={blurb}
                  readOnly={readOnly}
                  entries={draft[key]}
                  onChange={(entries) => setSection(key, entries)}
                />
              ))}
            </div>
          )}
        </section>

        {/* Region 2 — game-facing color palette; writes Data/palette.json.
            Its own draft + dirty + Save live inside the component. */}
        <RegistryPalette />
      </div>
    </div>
  );
}

function EnumSection({
  title,
  blurb,
  entries,
  onChange,
  readOnly = false,
}: {
  title: string;
  blurb: string;
  entries: RegistryEntry[];
  onChange: (entries: RegistryEntry[]) => void;
  readOnly?: boolean;
}) {
  function update(index: number, patch: Partial<RegistryEntry>) {
    onChange(entries.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }
  function remove(index: number) {
    onChange(entries.filter((_, i) => i !== index));
  }
  function add() {
    onChange([...entries, { value: "", description: "" }]);
  }

  return (
    <section className="flex flex-col gap-2 rounded-lg border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-medium text-sm">{title}</h2>
          <p className="text-muted-foreground text-xs">{blurb}</p>
        </div>
        {readOnly && (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-medium text-[0.65rem] text-muted-foreground uppercase tracking-wide">
            Read-only
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        {entries.length === 0 && <p className="text-muted-foreground text-xs">No values yet.</p>}
        {entries.map((entry, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: values can be transiently empty/duplicated while editing, so the index is the only stable row identity.
          <div key={i} className="flex items-center gap-2">
            <Input
              aria-label={`${title} value ${i + 1}`}
              className="w-40 shrink-0 font-mono text-xs uppercase"
              placeholder="VALUE"
              value={entry.value}
              disabled={readOnly}
              onChange={(e) => update(i, { value: e.currentTarget.value })}
            />
            <Input
              aria-label={`${title} description ${i + 1}`}
              className="min-w-0 flex-1 text-sm"
              placeholder="Description"
              value={entry.description}
              disabled={readOnly}
              onChange={(e) => update(i, { description: e.currentTarget.value })}
            />
            {!readOnly && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove ${entry.value || "value"}`}
                onClick={() => remove(i)}
              >
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
        ))}
      </div>

      {!readOnly && (
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={add}>
          <Plus className="size-4" /> Add value
        </Button>
      )}
    </section>
  );
}
