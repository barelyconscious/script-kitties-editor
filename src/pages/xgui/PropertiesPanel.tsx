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

import { Check, Copy, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { SpritePicker } from "@/components/data-tables/SpritePicker";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { colorCodeToCss } from "../../lib/guiBinding";
import type { GuiNode } from "../../lib/guiNode";
import { usePalette } from "../../lib/guiPalette";
import { ComponentPicker } from "./ComponentPicker";
import { useEditorStore } from "./editorState";
import {
  deriveRows,
  mintRowId,
  type OverrideRow,
  reconcileRows,
  rowsEqual,
  rowsToAttrs,
} from "./freeformRows";
import {
  COMPOUND_FIELD_LABELS,
  type CompoundFields,
  computedId,
  type FieldKind,
  fieldsForTag,
  formatCompound,
  isBoundField,
  nodeHasId,
  type PropertyField,
  parseCompound,
  srcBasename,
  withAttr,
} from "./guiProperties";
import { makeChildNode, nodePath } from "./guiTreeEdit";

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
  // The `coalesceKey` (per node + attr) folds a continuous typing burst in ONE
  // field into a single undo step (task 470); the field's blur commits a boundary
  // (see `onBlur` below) so leaving it opens a fresh step.
  const setAttr = (name: string, value: string) => {
    dispatch({
      type: "setNodeAttrs",
      nodeId: node.nodeId,
      attrs: withAttr(node.attrs, name, value),
      coalesceKey: `attr:${node.nodeId}:${name}`,
    });
  };
  // Replace the whole attrs map (used by freeform rename/remove, which can't be
  // expressed as a single set-or-clear). Keyed per node (the specific attr can
  // change across a rename) so a rename burst still coalesces sensibly.
  const setAttrs = (attrs: Record<string, string>) => {
    dispatch({
      type: "setNodeAttrs",
      nodeId: node.nodeId,
      attrs,
      coalesceKey: `attrs:${node.nodeId}`,
    });
  };

  const computed = computedId(path);
  // 475: Event nodes have NO id (task 471) — they are addressed by `name`/`handler`,
  // not by a hierarchical id. So hide BOTH the computed read-only id and the editable
  // local id for an Event; every other tag still shows them.
  const hasId = nodeHasId(node.tag);

  return (
    <div className="flex min-h-0 flex-col border-t">
      <div className="px-3 py-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
        Properties · <span className="font-mono text-foreground">{node.tag}</span>
      </div>

      {/* Commit-on-blur boundary (task 470): when focus leaves any property field,
          close the current coalescing run so the next field's edits open a fresh
          undo step — mirrors useHistoryState's commit-on-blur. onBlur bubbles from
          the inner inputs (React's onBlur is the focusout event), so one handler
          here covers every control below. */}
      {/** biome-ignore lint/a11y/noStaticElementInteractions: blur boundary on a container of focusable inputs; no interactive role needed */}
      <div
        className="min-h-0 overflow-y-auto px-3 pb-3"
        onBlur={() => dispatch({ type: "commitHistory" })}
      >
        {/* <Component> src — the included component's basename. Pinned to the very
            top and rendered as an obviously NON-editable, locked field: it is set
            once via the tree's component picker (when the <Component> is added) and
            never typed here. */}
        {node.tag === "Component" && (
          <FieldRow label="src">
            <div
              aria-readonly="true"
              title={`${node.attrs.src ?? ""} — set via the component picker (read-only)`}
              className="flex cursor-not-allowed items-center gap-1.5 rounded-md border border-dashed bg-muted/60 px-2 py-1 text-muted-foreground"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                {srcBasename(node.attrs.src) || "—"}
              </span>
            </div>
          </FieldRow>
        )}

        {/* Computed read-only hierarchical id + editable local id — hidden for Event
            nodes, which have no id (475). */}
        {hasId && (
          <>
            <FieldRow label="computed id">
              <div className="flex items-center gap-1 rounded-md border border-dashed bg-muted/40 pr-1 pl-2">
                <span
                  className="flex-1 truncate py-1 font-mono text-muted-foreground text-xs"
                  title={computed || "no id set"}
                >
                  {computed || "—"}
                </span>
                <CopyIdButton value={computed} />
              </div>
            </FieldRow>

            <FieldRow label="id">
              <Input
                value={node.attrs.id ?? ""}
                onChange={(e) => setAttr("id", e.currentTarget.value)}
                placeholder="local id"
                className="h-7 font-mono text-xs"
              />
            </FieldRow>
          </>
        )}

        {/* <Component> data — the key of a data-model OBJECT to seat as the mounted
            child's root (auto-populated from the child's token shape). A bare model
            key; clearing it removes the binding. Committed on BLUR (not per
            keystroke) so a half-typed name never spawns a throwaway model key. */}
        {node.tag === "Component" && (
          <FieldRow label="data">
            <DataKeyField
              key={node.nodeId}
              value={node.attrs.data ?? ""}
              onCommit={(v) => setAttr("data", v)}
            />
          </FieldRow>
        )}

        {/* The root View has no editable properties here — its id is auto-set on
            create and its controller is wired via the Controller tab. Instead of a
            dead-end note, offer the add-child actions so the panel is a starting
            point rather than an empty surface. */}
        {node.tag === "View" && <ViewChildAdder viewNodeId={node.nodeId} />}

        {/* Well-known fields for the tag. */}
        {fieldsForTag(node.tag).map((field) => (
          <SchemaField key={field.name} node={node} field={field} onSet={setAttr} />
        ))}

        {/* Freeform override rows (Component overrides + any unrecognized attr).
            Keyed by nodeId so switching the selected element re-derives fresh
            local rows for it (a clean mount), rather than carrying the previous
            node's in-progress rows across. Same-node external changes (undo/redo)
            are handled inside via reconcileRows. */}
        <FreeformRows key={node.nodeId} node={node} onReplace={setAttrs} />
      </div>
    </div>
  );
}

/**
 * The root `<View>` has no editable properties, so its Properties slice instead
 * offers the add-child actions — Add Panel / Add Text / Add Component — mirroring
 * the structure tree's add menu. Each dispatches the SAME `addChildNode` action
 * the tree uses (which appends under the View and selects the new node, so the
 * panel immediately swings to editing what you just added). Component opens the
 * shared {@link ComponentPicker} to choose a `src` basename first.
 */
function ViewChildAdder({ viewNodeId }: { viewNodeId: string }) {
  const { state, dispatch } = useEditorStore();
  const [pickerOpen, setPickerOpen] = useState(false);

  const addChild = (tag: "Panel" | "Text") =>
    dispatch({ type: "addChildNode", parentNodeId: viewNodeId, child: makeChildNode(tag) });

  const addComponent = (basename: string) => {
    dispatch({
      type: "addChildNode",
      parentNodeId: viewNodeId,
      child: makeChildNode("Component", basename),
    });
    setPickerOpen(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-1.5">
        <AddChildButton onClick={() => addChild("Panel")}>Add Panel</AddChildButton>
        <AddChildButton onClick={() => addChild("Text")}>Add Text</AddChildButton>
        <AddChildButton onClick={() => setPickerOpen(true)}>Add Component…</AddChildButton>
      </div>
      <ComponentPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={addComponent}
        excludeName={state.open?.name}
      />
    </div>
  );
}

/** A full-width add-child action button for the View properties slice. */
function AddChildButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-1.5 rounded-md border border-dashed px-2 py-1.5 text-left text-muted-foreground text-xs transition-colors hover:border-solid hover:bg-muted hover:text-foreground"
    >
      <Plus className="size-3.5 shrink-0" />
      {children}
    </button>
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

/**
 * Copy-to-clipboard affordance seated inside the read-only computed-id field.
 * Flashes a check for a beat after a successful copy; disabled when there is no id.
 */
function CopyIdButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard can reject (permissions/insecure context) — silently ignore.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      disabled={!value}
      title={value ? "Copy computed id" : "no id set"}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

/**
 * The `<Component>` `data` key input. Edits are LOCAL until BLUR (or Enter), so a
 * half-typed name like "b"/"bu"/"but" never lands on the node — which would spawn a
 * throwaway data-model object per keystroke. Mounted with a `key={nodeId}` by the
 * caller so selecting a different element gives it a fresh value; an external change
 * to the committed value (undo/redo) re-syncs the draft.
 */
function DataKeyField({ value, onCommit }: { value: string; onCommit: (next: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const next = draft.trim();
    if (next !== value) onCommit(next);
  };
  return (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      placeholder="data model key"
      className="h-7 font-mono text-xs"
    />
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
 *
 * STABLE ROW IDENTITY (task 486): the rows are driven from LOCAL state, each row
 * carrying a stable {@link OverrideRow.id} that survives name/value edits. The
 * inputs are keyed by that id (not the editable attr name), so typing never
 * remounts an input and focus is kept. Editing updates local state and commits a
 * rebuilt attrs map ({@link rowsToAttrs}) for live preview; an empty value is
 * KEPT (never treated as remove), and a row is removed ONLY via its x button.
 * `node.attrs` is re-synced into the rows only on EXTERNAL change (undo/redo,
 * another panel) via {@link reconcileRows}, preserving ids so focus survives.
 */
function FreeformRows({
  node,
  onReplace,
}: {
  node: GuiNode;
  onReplace: (attrs: Record<string, string>) => void;
}) {
  const isComponent = node.tag === "Component";

  // Local rows are the source of truth WHILE editing; `node.attrs` is synced in
  // on external change. The initializer derives fresh rows (with fresh ids) for
  // the node the panel first mounts on.
  const [rows, setRows] = useState<OverrideRow[]>(() => deriveRows(node));

  // Resync on EXTERNAL attr changes (undo/redo, another panel, switching the
  // selected node), preserving row ids where names still match so an in-flight
  // input is not remounted. reconcileRows returns a content-equal list when the
  // rows already mirror the attrs (our own commit just wrote them), so rowsEqual
  // skips the redundant update — avoiding a render loop.
  useEffect(() => {
    setRows((prev) => {
      const next = reconcileRows(prev, node);
      return rowsEqual(prev, next) ? prev : next;
    });
  }, [node, node.attrs]);

  // Apply a new row list: update local state AND commit the rebuilt attrs map so
  // the preview updates live. Blank-named rows are not committed (rowsToAttrs
  // skips them) but stay in local state so the user can keep filling them in.
  const apply = (next: OverrideRow[]) => {
    setRows(next);
    onReplace(rowsToAttrs(node, next));
  };

  const setName = (id: string, name: string) =>
    apply(rows.map((r) => (r.id === id ? { ...r, name } : r)));
  const setValue = (id: string, value: string) =>
    apply(rows.map((r) => (r.id === id ? { ...r, value } : r)));
  const removeRow = (id: string) => apply(rows.filter((r) => r.id !== id));

  // Add an in-progress blank row (only Component shows the affordance, since
  // freeform overrides are primarily a <Component> feature). Local-only until it
  // gets a name — no attr churn for an empty add.
  const addRow = () => {
    if (rows.some((r) => r.name === "")) return; // a blank row already exists
    setRows([...rows, { id: mintRowId(), name: "", value: "" }]);
  };

  if (rows.length === 0 && !isComponent) return null;

  return (
    <div className="mt-3 border-t pt-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
          {isComponent ? "Override properties" : "Other properties"}
        </span>
        {isComponent && (
          <button
            type="button"
            onClick={addRow}
            className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Plus className="size-3" /> Add
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-muted-foreground/60 text-xs">No override properties.</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((row) => (
            <div key={row.id} className="flex items-center gap-1">
              <Input
                value={row.name}
                onChange={(e) => setName(row.id, e.currentTarget.value)}
                placeholder="name"
                className="h-7 w-24 font-mono text-xs"
              />
              <Input
                value={row.value}
                onChange={(e) => setValue(row.id, e.currentTarget.value)}
                placeholder="literal or {token}"
                className={cn("h-7 flex-1 text-xs", isBoundField(row.value) && boundInputClass)}
              />
              <button
                type="button"
                aria-label={`Remove ${row.name || "property"}`}
                onClick={() => removeRow(row.id)}
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
