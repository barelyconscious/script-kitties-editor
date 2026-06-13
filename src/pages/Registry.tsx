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

/** The enum sections, in display order, with editor-facing copy. */
const SECTIONS: { key: RegistryEnumKey; title: string; blurb: string }[] = [
  {
    key: "combatTags",
    title: "Combat Tags",
    blurb: "Shared by abilities, biograms, and effects.",
  },
  { key: "itemTags", title: "Item Tags", blurb: "Available on items." },
  { key: "abilityShapes", title: "Ability Shapes", blurb: "Targeting shapes for abilities." },
  { key: "rarities", title: "Rarities", blurb: "Item rarity tiers — order matters (low → high)." },
  { key: "biomes", title: "Biomes", blurb: "World biomes for item drops." },
  { key: "damageTypes", title: "Damage Types", blurb: "Referenced by Lua scripts." },
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
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-semibold text-lg">Registry</h1>
          <p className="max-w-prose text-muted-foreground text-sm">
            Tweakable enums that populate the editor's dropdowns. Values are written into game data;
            descriptions are notes for you.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {status && (
            <span
              className={status.ok ? "text-muted-foreground text-sm" : "text-destructive text-sm"}
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

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {loading ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {SECTIONS.map(({ key, title, blurb }) => (
              <EnumSection
                key={key}
                title={title}
                blurb={blurb}
                entries={draft[key]}
                onChange={(entries) => setSection(key, entries)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EnumSection({
  title,
  blurb,
  entries,
  onChange,
}: {
  title: string;
  blurb: string;
  entries: RegistryEntry[];
  onChange: (entries: RegistryEntry[]) => void;
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
      <div>
        <h2 className="font-medium text-sm">{title}</h2>
        <p className="text-muted-foreground text-xs">{blurb}</p>
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
              onChange={(e) => update(i, { value: e.currentTarget.value })}
            />
            <Input
              aria-label={`${title} description ${i + 1}`}
              className="min-w-0 flex-1 text-sm"
              placeholder="Description"
              value={entry.description}
              onChange={(e) => update(i, { description: e.currentTarget.value })}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove ${entry.value || "value"}`}
              onClick={() => remove(i)}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </div>

      <Button type="button" variant="outline" size="sm" className="self-start" onClick={add}>
        <Plus className="size-4" /> Add value
      </Button>
    </section>
  );
}
