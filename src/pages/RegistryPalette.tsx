import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { colorCodeToCss, type Palette } from "@/lib/guiBinding";
import { invalidatePalette } from "@/lib/guiPalette";
import {
  DEFAULT_PALETTE_CODE,
  firstPaletteError,
  hexToRgb,
  type PaletteRow,
  paletteToRows,
  parseRgba,
  type Rgba,
  rgbaToCode,
  rgbaToHex,
  rowsToPalette,
} from "@/lib/guiPaletteEdit";

/** A CSS background that draws a light/dark checkerboard, so swatch alpha shows. */
const CHECKERBOARD: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(45deg, #cbd5e1 25%, transparent 25%), linear-gradient(-45deg, #cbd5e1 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #cbd5e1 75%), linear-gradient(-45deg, transparent 75%, #cbd5e1 75%)",
  backgroundSize: "8px 8px",
  backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0",
  backgroundColor: "#f8fafc",
};

/**
 * The GUI color palette region of the Registry tab. UNLIKE the enum sections, it
 * reads/writes `Data/palette.json` (game data the runtime reads) via the
 * `get_palette`/`save_palette` commands — NOT `editor.registry.json`. It therefore
 * owns its OWN draft + dirty flag + Save/Reset, co-located in this region's header,
 * fully independent of the enum Save. After a save it invalidates the module-level
 * palette cache so the GUI preview re-resolves named colors live.
 */
export default function RegistryPalette() {
  const [palette, setPalette] = useState<Palette>({});
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<PaletteRow[]>([]);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const loaded = await invoke<Palette>("get_palette");
      setPalette(loaded);
    } catch {
      // A read failure leaves us with the empty palette — same as a fresh project.
      setPalette({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Re-seed the draft from the loaded palette (initial load, and after our save
  // commits). In-progress edits are preserved between loads otherwise.
  useEffect(() => {
    setDraft(paletteToRows(palette));
  }, [palette]);

  const baselineRows = useMemo(() => paletteToRows(palette), [palette]);
  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(baselineRows),
    [draft, baselineRows],
  );

  // The set of names present at load time — used to warn that a rename/remove
  // breaks GUIs that reference the OLD name (which the thin editor can't update).
  const savedNames = useMemo(() => new Set(Object.keys(palette)), [palette]);
  // A rename is a saved name that no longer appears in the draft; a remove is the
  // same shape. Both are footguns, so one unconditional warning covers them.
  const hasBreakingRefChange = useMemo(() => {
    const draftNames = new Set(draft.map((r) => r.name.trim()));
    for (const name of savedNames) {
      if (!draftNames.has(name)) return true;
    }
    return false;
  }, [draft, savedNames]);

  function setRow(index: number, patch: Partial<PaletteRow>) {
    setStatus(null);
    setDraft((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }
  function removeRow(index: number) {
    setStatus(null);
    setDraft((prev) => prev.filter((_, i) => i !== index));
  }
  function addRow() {
    setStatus(null);
    setDraft((prev) => [...prev, { name: "", code: DEFAULT_PALETTE_CODE }]);
  }

  async function handleSave() {
    const err = firstPaletteError(draft);
    if (err) {
      setStatus({ ok: false, message: err });
      return;
    }
    setSaving(true);
    try {
      // Arg key must match the Rust parameter name (`palette`). rowsToPalette emits
      // keys in row order so the IndexMap-backed backend writes a minimal diff.
      const next = rowsToPalette(draft);
      await invoke("save_palette", { palette: next });
      setPalette(next);
      // Drop the module cache so every mounted preview re-resolves named colors.
      invalidatePalette();
      setStatus({ ok: true, message: "Saved." });
    } catch (e) {
      setStatus({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-base">GUI color palette</h2>
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.65rem] text-muted-foreground">
              Data/palette.json
            </code>
          </div>
          <p className="max-w-prose text-muted-foreground text-sm">
            Named theme colors the <strong>game</strong> reads at runtime. Recoloring a palette
            entry restyles every GUI that uses it by name.
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
            onClick={() => setDraft(baselineRows)}
          >
            <RotateCcw /> Reset
          </Button>
          <Button size="sm" disabled={!dirty || saving} onClick={() => void handleSave()}>
            <Save /> Save palette
          </Button>
        </div>
      </div>

      {hasBreakingRefChange && (
        <div className="mt-3 flex items-start gap-2 rounded border border-amber-500/40 bg-amber-100/50 px-3 py-2 text-amber-900 text-xs dark:bg-amber-900/20 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            GUIs that reference a renamed or removed color by name will stop resolving it — the
            editor can't update those references for you.
          </span>
        </div>
      )}

      <div className="mt-3">
        {loading ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : draft.length === 0 ? (
          <div className="rounded border border-dashed bg-background/40 px-4 py-6 text-center">
            <p className="text-muted-foreground text-sm">
              No colors yet. Colors you add here become named swatches in the GUI editor's color
              fields.
            </p>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={addRow}>
              <Plus className="size-4" /> Add color
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 lg:grid-cols-2 2xl:grid-cols-3">
            {draft.map((row, i) => (
              <PaletteRowEditor
                // biome-ignore lint/suspicious/noArrayIndexKey: names can be transiently empty/duplicated while editing, so the index is the only stable row identity.
                key={i}
                row={row}
                index={i}
                onChange={(patch) => setRow(i, patch)}
                onRemove={() => removeRow(i)}
              />
            ))}
          </div>
        )}
      </div>

      {!loading && draft.length > 0 && (
        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={addRow}>
          <Plus className="size-4" /> Add color
        </Button>
      )}
    </section>
  );
}

function PaletteRowEditor({
  row,
  index,
  onChange,
  onRemove,
}: {
  row: PaletteRow;
  index: number;
  onChange: (patch: Partial<PaletteRow>) => void;
  onRemove: () => void;
}) {
  const css = colorCodeToCss(row.code);
  const label = row.name.trim() || `color ${index + 1}`;

  return (
    <div className="flex items-center gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Recolor ${label}`}
            className="size-8 shrink-0 overflow-hidden rounded border"
            style={CHECKERBOARD}
          >
            <span className="block size-full" style={{ backgroundColor: css }} />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-56" align="start">
          <RgbaPicker
            rgba={parseRgba(row.code)}
            onChange={(rgba) => onChange({ code: rgbaToCode(rgba) })}
          />
        </PopoverContent>
      </Popover>

      <Input
        aria-label={`Color name ${index + 1}`}
        className="min-w-0 flex-1 font-mono text-xs"
        placeholder="ColorName"
        value={row.name}
        onChange={(e) => onChange({ name: e.currentTarget.value })}
      />
      <Input
        aria-label={`Color code ${index + 1}`}
        className="min-w-0 flex-1 font-mono text-xs"
        placeholder="r,g,b,a"
        value={row.code}
        onChange={(e) => onChange({ code: e.currentTarget.value })}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

/**
 * A small RGBA picker: a native color input for hue/saturation (alpha-blind) plus
 * four numeric channel inputs so alpha is editable. Writes back through the row's
 * code, keeping the swatch and the code field in sync.
 */
function RgbaPicker({ rgba, onChange }: { rgba: Rgba; onChange: (rgba: Rgba) => void }) {
  function setChannel(key: keyof Rgba, raw: string) {
    const n = Number(raw);
    onChange({
      ...rgba,
      [key]: Number.isFinite(n) ? Math.max(0, Math.min(255, Math.round(n))) : 0,
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        type="color"
        aria-label="Pick color"
        className="h-9 w-full cursor-pointer rounded border bg-transparent"
        value={rgbaToHex(rgba)}
        onChange={(e) => {
          const { r, g, b } = hexToRgb(e.currentTarget.value);
          onChange({ ...rgba, r, g, b });
        }}
      />
      <div className="grid grid-cols-4 gap-2">
        {(["r", "g", "b", "a"] as const).map((ch) => (
          <div key={ch} className="flex flex-col gap-1">
            <Label className="text-center text-[0.65rem] text-muted-foreground uppercase">
              {ch}
            </Label>
            <Input
              aria-label={`${ch} channel`}
              className="h-8 px-1 text-center text-xs"
              inputMode="numeric"
              value={String(rgba[ch])}
              onChange={(e) => setChannel(ch, e.currentTarget.value)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
