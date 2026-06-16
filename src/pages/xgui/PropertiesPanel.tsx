/**
 * PropertiesPanel — the MIDDLE slice of the structure column (F9b): the property
 * editor for the currently-selected {@link GuiNode}. Edits write back to the
 * node's `attrs` via the shared store's `setNodeAttrs` action, which marks the
 * component dirty and re-renders the preview live (the preview reads the same
 * store root).
 *
 * Layout (design "Structure column" → Properties):
 *  • a computed READ-ONLY hierarchical id at the top (e.g. `view.stats.statText`,
 *    derived from the parent chain of authored `id` attrs);
 *  • the editable LOCAL `id` below it;
 *  • the element's well-known properties as typed fields (text, four-field
 *    compound `position`/`size`, color swatch picker, sprite selector, boolean);
 *  • for `<Component>`: a read-only `src` basename (set via the tree's picker)
 *    plus freeform override property rows.
 *
 * The tricky transforms (computed-id, four-field ↔ comma-string, literal-vs-token
 * detection, the per-tag schema) live in the pure {@link import("./guiProperties")}
 * module so this file stays a thin rendering shell.
 *
 * @see design/xgui_ta.md — "Structure column" (Properties), "Data binding",
 *   "Colors and the palette".
 */

import { Plus, Trash2 } from "lucide-react";
import { SpritePicker } from "@/components/data-tables/SpritePicker";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { colorCodeToCss } from "../../lib/guiBinding";
import type { GuiNode } from "../../lib/guiNode";
import { usePalette } from "../../lib/guiPalette";
import { useEditorStore } from "./editorState";
import {
  COMPOUND_FIELD_LABELS,
  type CompoundFields,
  computedId,
  type FieldKind,
  fieldsForTag,
  formatCompound,
  freeformAttrs,
  isBoundField,
  type PropertyField,
  parseCompound,
  renameAttr,
  srcBasename,
  withAttr,
} from "./guiProperties";
import { nodePath } from "./guiTreeEdit";

export function PropertiesPanel() {
  const { state, dispatch } = useEditorStore();
  const open = state.open;
  const selectedId = state.selectedNodeId;

  if (!open) return null;

  const path = selectedId ? nodePath(open.root, selectedId) : null;
  const node = path ? path[path.length - 1] : null;

  if (!node || !path) {
    return (
      <div className="border-t px-3 py-3 text-center text-muted-foreground/60 text-xs">
        Select an element to edit its properties.
      </div>
    );
  }

  // Write one attribute back to the selected node, immutably. The pure
  // `withAttr` set-or-clear keeps the XML minimal (clearing removes the attr).
  const setAttr = (name: string, value: string) => {
    dispatch({
      type: "setNodeAttrs",
      nodeId: node.nodeId,
      attrs: withAttr(node.attrs, name, value),
    });
  };
  // Replace the whole attrs map (used by freeform rename/remove, which can't be
  // expressed as a single set-or-clear).
  const setAttrs = (attrs: Record<string, string>) => {
    dispatch({ type: "setNodeAttrs", nodeId: node.nodeId, attrs });
  };

  const computed = computedId(path);

  return (
    <div className="flex min-h-0 flex-col border-t">
      <div className="px-3 py-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
        Properties · <span className="font-mono text-foreground">{node.tag}</span>
      </div>

      <div className="min-h-0 overflow-y-auto px-3 pb-3">
        {/* Computed read-only hierarchical id. */}
        <FieldRow label="computed id">
          <div
            className="truncate rounded border border-dashed bg-muted/40 px-2 py-1 font-mono text-muted-foreground text-xs"
            title={computed || "no id set"}
          >
            {computed || "—"}
          </div>
        </FieldRow>

        {/* Editable local id. */}
        <FieldRow label="id">
          <Input
            value={node.attrs.id ?? ""}
            onChange={(e) => setAttr("id", e.currentTarget.value)}
            placeholder="local id"
            className="h-7 font-mono text-xs"
          />
        </FieldRow>

        {/* <Component> src — read-only basename, set via the tree picker. */}
        {node.tag === "Component" && (
          <FieldRow label="src">
            <div
              className="truncate rounded border bg-muted/40 px-2 py-1 font-mono text-xs"
              title={node.attrs.src ?? ""}
            >
              {srcBasename(node.attrs.src) || "—"}
            </div>
          </FieldRow>
        )}

        {/* Well-known fields for the tag. */}
        {fieldsForTag(node.tag).map((field) => (
          <SchemaField key={field.name} node={node} field={field} onSet={setAttr} />
        ))}

        {/* Freeform override rows (Component overrides + any unrecognized attr). */}
        <FreeformRows node={node} onSet={setAttr} onReplace={setAttrs} />
      </div>
    </div>
  );
}

/** A labeled property row: a small label above its control. */
function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <span className="mb-0.5 block font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
      {children}
    </div>
  );
}

/** Render one schema field by its kind. */
function SchemaField({
  node,
  field,
  onSet,
}: {
  node: GuiNode;
  field: PropertyField;
  onSet: (name: string, value: string) => void;
}) {
  const value = node.attrs[field.name] ?? "";
  return (
    <FieldRow label={field.label}>
      <FieldControl kind={field.kind} name={field.name} value={value} onSet={onSet} />
    </FieldRow>
  );
}

/** The input control for a given field kind. */
function FieldControl({
  kind,
  name,
  value,
  onSet,
}: {
  kind: FieldKind;
  name: string;
  value: string;
  onSet: (name: string, value: string) => void;
}) {
  switch (kind) {
    case "compound":
      return <CompoundField name={name} value={value} onSet={onSet} />;
    case "color":
      return <ColorField name={name} value={value} onSet={onSet} />;
    case "sprite":
      return <SpriteField name={name} value={value} onSet={onSet} />;
    case "boolean":
      return <BooleanField name={name} value={value} onSet={onSet} />;
    default:
      return (
        <Input
          value={value}
          onChange={(e) => onSet(name, e.currentTarget.value)}
          placeholder="literal or {token}"
          className={cn("h-7 text-xs", isBoundField(value) && boundInputClass)}
        />
      );
  }
}

/** Shared styling for an input whose value is a `{token}` binding. */
const boundInputClass = "border-sky-500/60 bg-sky-500/10 font-mono text-sky-300";

/**
 * `position`/`size` as four labeled inputs (scale-x, scale-y, offset-x,
 * offset-y). Each field accepts a literal OR a `{token}`; bound fields are
 * styled distinctly. The serialized attr stays the comma form.
 */
function CompoundField({
  name,
  value,
  onSet,
}: {
  name: string;
  value: string;
  onSet: (name: string, value: string) => void;
}) {
  const fields = parseCompound(value);
  const setField = (key: keyof CompoundFields, fieldValue: string) => {
    onSet(name, formatCompound({ ...fields, [key]: fieldValue }));
  };
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {COMPOUND_FIELD_LABELS.map(({ key, label }) => {
        const fieldValue = fields[key];
        return (
          <div key={key} className="flex flex-col gap-0.5">
            <span className="text-[10px] text-muted-foreground/80">{label}</span>
            <Input
              value={fieldValue}
              onChange={(e) => setField(key, e.currentTarget.value)}
              placeholder="0 or {token}"
              aria-label={label}
              className={cn("h-7 text-xs", isBoundField(fieldValue) && boundInputClass)}
            />
          </div>
        );
      })}
    </div>
  );
}

/** A boolean property (true/false) that also accepts a `{token}`. */
function BooleanField({
  name,
  value,
  onSet,
}: {
  name: string;
  value: string;
  onSet: (name: string, value: string) => void;
}) {
  const bound = isBoundField(value);
  return (
    <div className="flex items-center gap-1.5">
      <select
        value={bound ? "__token__" : value === "" ? "" : value}
        onChange={(e) => {
          const v = e.currentTarget.value;
          if (v === "__token__") return; // keep typing the token in the input
          onSet(name, v);
        }}
        disabled={bound}
        className="h-7 rounded-md border border-input bg-transparent px-1.5 text-xs disabled:opacity-50"
      >
        <option value="">default</option>
        <option value="true">true</option>
        <option value="false">false</option>
        {bound && <option value="__token__">{`{token}`}</option>}
      </select>
      <Input
        value={value}
        onChange={(e) => onSet(name, e.currentTarget.value)}
        placeholder="or {token}"
        className={cn("h-7 flex-1 text-xs", bound && boundInputClass)}
      />
    </div>
  );
}

/** `texture` via the shared sprite selector; also accepts a `{token}`. */
function SpriteField({
  name,
  value,
  onSet,
}: {
  name: string;
  value: string;
  onSet: (name: string, value: string) => void;
}) {
  const bound = isBoundField(value);
  return (
    <div className="space-y-1">
      {!bound && <SpritePicker value={value} onChange={(n) => onSet(name, n)} />}
      <Input
        value={value}
        onChange={(e) => onSet(name, e.currentTarget.value)}
        placeholder="sprite name or {token}"
        className={cn("h-7 text-xs", bound && boundInputClass)}
      />
    </div>
  );
}

/**
 * A color field: palette entries as named swatches + a custom color-code entry +
 * a `{token}` option. The text input below always reflects the raw stored value
 * (a palette name, an `r,g,b,a` code, or a `{token}`), so any of the three forms
 * can be typed directly; the swatch popover is the discoverable pick path.
 */
function ColorField({
  name,
  value,
  onSet,
}: {
  name: string;
  value: string;
  onSet: (name: string, value: string) => void;
}) {
  const palette = usePalette();
  const bound = isBoundField(value);
  const entries = Object.entries(palette);
  // Preview swatch: a {token} can't preview (no model here), a palette name maps
  // through the palette, and a literal code renders directly.
  const previewCode = bound ? undefined : (palette[value.trim()] ?? value);
  const css = colorCodeToCss(previewCode);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Pick color"
              className="size-7 shrink-0 rounded border bg-[length:8px_8px] bg-[position:0_0,4px_4px] [background-image:linear-gradient(45deg,#888_25%,transparent_25%,transparent_75%,#888_75%,#888),linear-gradient(45deg,#888_25%,transparent_25%,transparent_75%,#888_75%,#888)]"
            >
              <span
                className="block size-full rounded"
                style={css ? { backgroundColor: css } : undefined}
              />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-60 p-2" align="start">
            <p className="mb-1 font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
              Palette
            </p>
            {entries.length === 0 ? (
              <p className="px-1 py-1 text-muted-foreground text-xs">
                No named colors yet. Add them in the Registry, or type a code below.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-0.5">
                {entries.map(([colorName, code]) => {
                  const swatchCss = colorCodeToCss(code);
                  return (
                    <button
                      key={colorName}
                      type="button"
                      onClick={() => onSet(name, colorName)}
                      className={cn(
                        "flex items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-muted",
                        value.trim() === colorName && "bg-muted",
                      )}
                    >
                      <span
                        className="size-4 shrink-0 rounded border"
                        style={swatchCss ? { backgroundColor: swatchCss } : undefined}
                      />
                      <span className="truncate font-mono">{colorName}</span>
                      <span className="ml-auto truncate text-[10px] text-muted-foreground/60">
                        {code}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            <p className="mt-2 text-[10px] text-muted-foreground">
              Or type a custom <span className="font-mono">r,g,b,a</span> code or a{" "}
              <span className="font-mono">{`{token}`}</span> in the field.
            </p>
          </PopoverContent>
        </Popover>
        <Input
          value={value}
          onChange={(e) => onSet(name, e.currentTarget.value)}
          placeholder="palette name, r,g,b,a, or {token}"
          className={cn("h-7 flex-1 font-mono text-xs", bound && boundInputClass)}
        />
      </div>
    </div>
  );
}

/**
 * The freeform override rows — name→value pairs the schema doesn't cover (a
 * `<Component>`'s arbitrary override props, or any unrecognized attribute).
 * Renaming a key and editing/removing its value are supported; an "Add property"
 * button appends a blank row.
 */
function FreeformRows({
  node,
  onSet,
  onReplace,
}: {
  node: GuiNode;
  onSet: (name: string, value: string) => void;
  onReplace: (attrs: Record<string, string>) => void;
}) {
  const names = freeformAttrs(node);
  const isComponent = node.tag === "Component";

  // A blank key is the in-progress "Add property" row; only Component (and other
  // tags via an unrecognized attr) shows the add affordance, since freeform
  // overrides are primarily a <Component> feature.
  const addBlank = () => {
    if ("" in node.attrs) return; // a blank row already exists
    onReplace({ ...node.attrs, "": "" });
  };

  if (names.length === 0 && !isComponent) return null;

  return (
    <div className="mt-3 border-t pt-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
          {isComponent ? "Override properties" : "Other properties"}
        </span>
        {isComponent && (
          <button
            type="button"
            onClick={addBlank}
            className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Plus className="size-3" /> Add
          </button>
        )}
      </div>
      {names.length === 0 ? (
        <p className="text-muted-foreground/60 text-xs">No override properties.</p>
      ) : (
        <div className="space-y-1.5">
          {names.map((attrName) => (
            <div key={attrName} className="flex items-center gap-1">
              <Input
                value={attrName}
                onChange={(e) => onReplace(renameAttr(node.attrs, attrName, e.currentTarget.value))}
                placeholder="name"
                className="h-7 w-24 font-mono text-xs"
              />
              <Input
                value={node.attrs[attrName] ?? ""}
                onChange={(e) => onSet(attrName, e.currentTarget.value)}
                placeholder="literal or {token}"
                className={cn(
                  "h-7 flex-1 text-xs",
                  isBoundField(node.attrs[attrName] ?? "") && boundInputClass,
                )}
              />
              <button
                type="button"
                aria-label={`Remove ${attrName}`}
                onClick={() => onSet(attrName, "")}
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
