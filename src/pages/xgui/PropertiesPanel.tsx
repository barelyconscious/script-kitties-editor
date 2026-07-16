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

import { Check, ChevronRight, Copy, Lock, Plus, Search, Trash2, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { SpritePicker } from "@/components/data-tables/SpritePicker";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { colorCodeToCss } from "../../lib/guiBinding";
import type { GuiNode, GuiTag } from "../../lib/guiNode";
import { usePalette } from "../../lib/guiPalette";
import { ComponentPicker } from "./ComponentPicker";
import { exportedFunctionNames } from "./controllerScript";
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
  compoundLiveWrite,
  computedId,
  fieldsForTag,
  formatCompound,
  isBoundField,
  nodeHasId,
  normalizeBinding,
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
  // A LOCKED node is read-only here: every control is disabled and the writeback
  // setters no-op, so nothing about it can be edited until it is unlocked from the
  // structure tree (or via the unlock button surfaced in the banner below).
  const locked = node != null && state.lockedNodeIds.has(node.nodeId);

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
    if (locked) return; // read-only while locked (defense; controls are disabled too)
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
    if (locked) return; // read-only while locked (defense; controls are disabled too)
    dispatch({
      type: "setNodeAttrs",
      nodeId: node.nodeId,
      attrs,
      coalesceKey: `attrs:${node.nodeId}`,
    });
  };

  const computed = computedId(path);
  // Tags with no id (GridLayout, the root View) hide BOTH the computed read-only id
  // and the editable local id; every other tag shows them.
  const hasId = nodeHasId(node.tag);
  // The parent tag (the node just above the selected one in the path) decides
  // whether the selected node OWNS its geometry: a child of a <GridLayout> does
  // not — the grid lays it out — so fieldsForTag drops its position/size rows.
  const parentTag = path.length >= 2 ? path[path.length - 2].tag : undefined;

  return (
    <div className="flex min-h-0 flex-col border-t">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Properties · <span className="font-mono text-foreground">{node.tag}</span>
        </span>
        {locked && (
          // Surface the unlock action right where the read-only state is felt, so the
          // user isn't forced back to the tree to re-enable editing.
          <button
            type="button"
            onClick={() => dispatch({ type: "toggleLock", nodeId: node.nodeId })}
            title="Unlock this element to edit its properties"
            className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground uppercase tracking-wide transition-colors hover:bg-muted hover:text-foreground"
          >
            <Lock className="size-3 text-foreground" /> Locked
          </button>
        )}
      </div>

      {/* Commit-on-blur boundary (task 470): when focus leaves any property field,
          close the current coalescing run so the next field's edits open a fresh
          undo step — mirrors useHistoryState's commit-on-blur. onBlur bubbles from
          the inner inputs (React's onBlur is the focusout event), so one handler
          here covers every control below.

          LOCK (task: element lock): a locked node renders the SAME fields, but the
          whole field region is wrapped in a disabled <fieldset> so every native
          control (input/select/button) inside is non-interactive — the visual,
          accessible read-only state. The setters also no-op as defense. The
          fieldset is reset to lay out like a plain block (no border/margin) and
          dims while locked. */}
      {/** biome-ignore lint/a11y/noStaticElementInteractions: blur boundary on a container of focusable inputs; no interactive role needed */}
      <div
        className="min-h-0 overflow-y-auto px-3 pb-3"
        onBlur={() => dispatch({ type: "commitHistory" })}
      >
        <fieldset
          disabled={locked}
          className={cn("m-0 min-w-0 border-0 p-0", locked && "opacity-60")}
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

          {/* Computed read-only hierarchical id + editable local id — hidden for tags
            with no id (GridLayout, the root View). */}
          {hasId && (
            <>
              <FieldRow label="computed id">
                <div className="flex items-center gap-1 rounded-md border border-dashed bg-muted/40 pr-1 pl-2">
                  <span
                    className="min-w-0 flex-1 truncate py-1 font-mono text-muted-foreground text-xs"
                    title={computed || "no id set"}
                  >
                    {computed || "—"}
                  </span>
                  <CopyIdButton value={computed} />
                </div>
              </FieldRow>

              <FieldRow label="id">
                <IdField
                  value={node.attrs.id ?? ""}
                  onChange={(value) => setAttr("id", value)}
                  autoFocus={state.pendingIdFocusNodeId === node.nodeId}
                  onAutoFocused={() => dispatch({ type: "consumeIdFocus" })}
                />
              </FieldRow>
            </>
          )}

          {/* The root View's structural attrs are managed elsewhere (id auto-set on
            create; controller via the Controller tab); its one schema field
            (scopeName) renders via the map below. Offer the add-child actions here
            so the panel is a starting point rather than a near-empty surface. */}
          {node.tag === "View" && <ViewChildAdder viewNodeId={node.nodeId} />}

          {/* Well-known fields for the tag (position/size suppressed for a grid
            child — the parent GridLayout owns its geometry). Ungrouped fields
            render inline; fields tagged with a `group` collapse under a section
            header below (schema-driven — grouped generically by the group key). */}
          <SchemaFields node={node} parentTag={parentTag} onSet={setAttr} />

          {/* Freeform override rows (Component overrides + any unrecognized attr).
            Keyed by nodeId so switching the selected element re-derives fresh
            local rows for it (a clean mount), rather than carrying the previous
            node's in-progress rows across. Same-node external changes (undo/redo)
            are handled inside via reconcileRows. */}
          <FreeformRows key={node.nodeId} node={node} onReplace={setAttrs} />
        </fieldset>
      </div>
    </div>
  );
}

/**
 * The editable local-`id` input. Extracted into its own component so it can own a
 * ref + effect: when `autoFocus` flips true (the node was just CREATED via the
 * tree/View add-child, which sets {@link import("./editorState").EditorState.pendingIdFocusNodeId}),
 * it focuses and SELECTS the field so the first keystroke replaces the auto-assigned
 * id (`Panel1`, …), then calls `onAutoFocused` to consume the one-shot request.
 * Selecting an existing element by CLICK never sets `autoFocus`, so clicking around
 * the tree never steals focus into this field. A focus attempt is skipped when the
 * input is disabled (a locked node's fieldset), which never coincides with a fresh add.
 */
function IdField({
  value,
  onChange,
  autoFocus,
  onAutoFocused,
}: {
  value: string;
  onChange: (value: string) => void;
  autoFocus: boolean;
  onAutoFocused: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!autoFocus) return;
    const input = ref.current;
    if (!input || input.disabled) return;
    // Defer to the next frame: the add-child menu (a Radix ContextMenu) restores
    // focus to its trigger row when it closes, which can land AFTER this commit and
    // steal focus. Focusing on the next frame runs after that, so the id field wins.
    const raf = requestAnimationFrame(() => {
      input.focus();
      input.select(); // pre-select the auto-id so the first keystroke replaces it
      onAutoFocused();
    });
    return () => cancelAnimationFrame(raf);
  }, [autoFocus, onAutoFocused]);
  return (
    <Input
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      placeholder="local id"
      className="h-7 font-mono text-xs"
    />
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
 * A whole-value BINDING field (`data` / `dataCollection` / `tooltipData`). The input
 * shows and edits the STORED token VERBATIM (`{$.selectedKittypack}`), so the field is
 * WYSIWYG with the XML — what you type is what's stored. {@link normalizeBinding} is a
 * convenience on commit only: a bare key or `$.`-prefixed path the author types
 * (`creatures` / `$.creatures`) is wrapped into the grammar's whole-value token form
 * (`{$.creatures}`) — the only form the strict resolver + scaffold accept — while a
 * hand-typed full token is kept exactly as written.
 *
 * Edits are LOCAL until BLUR (or Enter): a half-typed token like "{$.c"/"{$.cr" never
 * commits — which would otherwise spawn a throwaway data-model object per keystroke.
 * An external change to the committed value (undo/redo, node switch) re-syncs the draft.
 */
function BindingField({ value, onCommit }: { value: string; onCommit: (next: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const next = normalizeBinding(draft);
    if (next !== value) onCommit(next);
    // Re-sync the field to the normalized/stored form so a convenience wrap (e.g.
    // `creatures` → `{$.creatures}`) is reflected even when the stored value is
    // unchanged and the `value`-effect doesn't fire.
    else if (next !== draft) setDraft(next);
  };
  return (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      placeholder="{$.model.path}"
      className="h-7 font-mono text-xs"
    />
  );
}

/**
 * The tag's well-known fields, split into inline (ungrouped) rows and collapsible
 * grouped sections. The split is SCHEMA-DRIVEN — fields are grouped generically by
 * their {@link PropertyField.group} key (in first-appearance order), so the panel
 * never hardcodes "Interaction". Ungrouped fields render exactly as before; each
 * group renders under a {@link FieldGroup} section header.
 */
function SchemaFields({
  node,
  parentTag,
  onSet,
}: {
  node: GuiNode;
  parentTag: GuiTag | undefined;
  onSet: (name: string, value: string) => void;
}) {
  const fields = fieldsForTag(node.tag, parentTag);
  const ungrouped: PropertyField[] = [];
  const groupOrder: string[] = [];
  const grouped = new Map<string, PropertyField[]>();
  for (const field of fields) {
    if (!field.group) {
      ungrouped.push(field);
      continue;
    }
    const existing = grouped.get(field.group);
    if (existing) {
      existing.push(field);
    } else {
      grouped.set(field.group, [field]);
      groupOrder.push(field.group);
    }
  }

  return (
    <>
      {ungrouped.map((field) => (
        <SchemaField key={field.name} node={node} field={field} onSet={onSet} />
      ))}
      {groupOrder.map((group) => (
        // Keyed by nodeId + group so switching the selected element re-derives the
        // section's default collapsed/expanded state for the new node (a fresh mount)
        // rather than carrying the previous node's toggle across.
        <FieldGroup
          key={`${node.nodeId}:${group}`}
          title={group}
          fields={grouped.get(group) ?? []}
          node={node}
          onSet={onSet}
        />
      ))}
    </>
  );
}

/**
 * A collapsible section for a group of schema fields (e.g. "Interaction"). The
 * section is COLLAPSED by default when the node carries NONE of its fields, and
 * EXPANDED when any is present — so an element that already wires up interaction
 * opens showing it, while a plain element keeps the section tucked away. Presence
 * (the attr KEY existing), not a non-empty value, is the test: the structure tree's
 * "Add handler" writes an EMPTY handler attr then selects the node, and the present
 * key must open the group so the author lands on the field to fill in. Clearing a
 * field removes its attr (see {@link withAttr}), so an all-cleared group
 * re-collapses on its next mount. The initial state is computed once on mount; the
 * parent keys this by nodeId so a node switch remounts with a freshly-computed default.
 */
function FieldGroup({
  title,
  fields,
  node,
  onSet,
}: {
  title: string;
  fields: PropertyField[];
  node: GuiNode;
  onSet: (name: string, value: string) => void;
}) {
  const anySet = fields.some((f) => f.name in node.attrs);
  const [open, setOpen] = useState(anySet);

  return (
    <div className="mt-3 border-t pt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mb-1 flex w-full items-center gap-1 font-medium text-[10px] text-muted-foreground uppercase tracking-wide transition-colors hover:text-foreground"
      >
        <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
        {title}
        {!open && anySet && <span className="ml-1 size-1.5 rounded-full bg-sky-500" />}
      </button>
      {open && (
        <div>
          {fields.map((field) => (
            <SchemaField key={field.name} node={node} field={field} onSet={onSet} />
          ))}
        </div>
      )}
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
      <FieldControl field={field} value={value} onSet={onSet} />
    </FieldRow>
  );
}

/** The input control for a given field kind. */
function FieldControl({
  field,
  value,
  onSet,
}: {
  field: PropertyField;
  value: string;
  onSet: (name: string, value: string) => void;
}) {
  const { name, kind } = field;
  switch (kind) {
    case "binding":
      // A whole-value binding (data / dataCollection / tooltipData) — shows/edits the
      // grammar token VERBATIM (WYSIWYG with the XML), committed on blur/Enter (not per
      // keystroke) so a half-typed token doesn't spawn a throwaway scaffold entry per
      // character. A bare key typed as convenience is normalized to the token on commit.
      return <BindingField value={value} onCommit={(v) => onSet(name, v)} />;
    case "compound":
      // `literalOnly` (grid `cellSize`) drops the per-field {token} affordance — grid
      // structure is stamped at load, so a token can never bind (it is an ERROR lint).
      return (
        <CompoundField name={name} value={value} onSet={onSet} literalOnly={field.literalOnly} />
      );
    case "color":
      return <ColorField name={name} value={value} onSet={onSet} />;
    case "sprite":
      return <SpriteField name={name} value={value} onSet={onSet} />;
    case "boolean":
      // `literalOnly` (modal) drops the {token} affordance — the engine reads it
      // pre-binding, so a token there is a lint, not a binding.
      return (
        <BooleanField name={name} value={value} onSet={onSet} literalOnly={field.literalOnly} />
      );
    case "handler":
      return <HandlerField name={name} value={value} onSet={onSet} />;
    case "componentRef":
      return <ComponentRefField name={name} value={value} onSet={onSet} />;
    default:
      // A `literalOnly` text field (grid structure: rows/columns/gutter/cellSize) drops
      // the `{token}` affordance — the value is stamped at load, so a token can never
      // bind (it is an ERROR lint). Everything else advertises literal-or-token.
      return (
        <Input
          value={value}
          onChange={(e) => onSet(name, e.currentTarget.value)}
          placeholder={field.literalOnly ? "literal only" : "literal or {token}"}
          className={cn(
            "h-7 text-xs",
            !field.literalOnly && isBoundField(value) && boundInputClass,
          )}
        />
      );
  }
}

/** Shared styling for a handler input whose typed name isn't a known controller function. */
const handlerWarnClass = "border-amber-500/60 bg-amber-500/10";

/**
 * An interaction HANDLER field: a dropdown of the open component's controller
 * function names that STILL allows free typing (a native `<datalist>`), since a hot
 * reload may add the function after the handler is wired. There is NO `{token}`
 * affordance (a handler names which function fires, not how the element looks).
 *
 * A typed name that isn't among the controller's exported functions gets a
 * SOFT-WARNING state (amber input + hint) but is never blocked. The warning is
 * suppressed when we have no function list to check against — a controller not yet
 * loaded (its text lazy-loads on first Controller-tab view) or a controller-less
 * component — so a fresh panel never false-warns.
 */
function HandlerField({
  name,
  value,
  onSet,
}: {
  name: string;
  value: string;
  onSet: (name: string, value: string) => void;
}) {
  const { state } = useEditorStore();
  const source = state.open?.controllerText ?? "";
  const names = useMemo(() => exportedFunctionNames(source), [source]);
  const listId = useId();
  const trimmed = value.trim();
  // Only warn when we HAVE a list to check against: an empty list means "not loaded"
  // or "no controller", where an unknown name isn't actually knowable.
  const unknown = names.length > 0 && trimmed !== "" && !names.includes(trimmed);

  return (
    <div className="space-y-1">
      <Input
        list={listId}
        value={value}
        onChange={(e) => onSet(name, e.currentTarget.value)}
        placeholder="controller function"
        className={cn("h-7 font-mono text-xs", unknown && handlerWarnClass)}
      />
      <datalist id={listId}>
        {names.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      {unknown && (
        <p className="text-[10px] text-amber-500">
          Not a known controller function — it may be added on reload.
        </p>
      )}
    </div>
  );
}

/**
 * A COMPONENT-reference field (the `tooltip` attr): the current component shown as a
 * button that opens the shared {@link ComponentPicker}, plus a clear affordance. The
 * picker emits the canonical `.xml`-suffixed ref (`gui.kittypacks-tooltip.xml`) — the
 * exact form the engine resolves on — which is stored verbatim; the display strips the
 * extension for readability. Literal-only (structural): no `{token}` affordance.
 */
function ComponentRefField({
  name,
  value,
  onSet,
}: {
  name: string;
  value: string;
  onSet: (name: string, value: string) => void;
}) {
  const { state } = useEditorStore();
  const [pickerOpen, setPickerOpen] = useState(false);
  const current = value.trim();

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className="flex h-7 min-w-0 flex-1 items-center rounded-md border px-2 text-left text-xs transition-colors hover:bg-muted"
      >
        <span
          className={cn("min-w-0 flex-1 truncate font-mono", !current && "text-muted-foreground")}
        >
          {current ? srcBasename(current) : "Choose component…"}
        </span>
      </button>
      {current && (
        <button
          type="button"
          aria-label="Clear tooltip component"
          onClick={() => onSet(name, "")}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
        >
          <X className="size-3" />
        </button>
      )}
      <ComponentPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={(src) => onSet(name, src)}
        excludeName={state.open?.name}
      />
    </div>
  );
}

/** Shared styling for an input whose value is a `{token}` binding. */
const boundInputClass = "border-sky-500/60 bg-sky-500/10 font-mono text-sky-300";

/**
 * `position`/`size` as four labeled inputs (scale-x, scale-y, offset-x,
 * offset-y). Each field accepts a literal OR a `{token}`; bound fields are
 * styled distinctly. The serialized attr stays the comma form.
 *
 * When `literalOnly` is set (grid `cellSize`, whose structure is stamped at load and
 * cannot bind), each field drops the `{token}` affordance — no bound styling, and the
 * placeholder advertises "literal only" — mirroring the literal-only text field.
 */
function CompoundField({
  name,
  value,
  onSet,
  literalOnly,
}: {
  name: string;
  value: string;
  onSet: (name: string, value: string) => void;
  literalOnly?: boolean;
}) {
  const fields = parseCompound(value);
  // Transient edit buffer for the CURRENTLY-FOCUSED field ONLY (task 521). While
  // a field has focus its display comes from `draft` — which may be EMPTY
  // mid-edit, so clearing a cell no longer snaps a `0` back in and typing `23`
  // yields `23` rather than `023`. Every NON-focused field reads straight from
  // `fields` (the value prop), so external writes (undo/redo, node switch,
  // drag-to-move writing `position` live) always show through. The buffer is
  // dropped on blur, so it never shields a field the user has left.
  const [draft, setDraft] = useState<{ key: keyof CompoundFields; text: string } | null>(null);

  const change = (key: keyof CompoundFields, text: string) => {
    setDraft({ key, text });
    // A non-empty edit commits live so the preview keeps updating; an emptied
    // field DEFERS (compoundLiveWrite → null) so the store isn't coerced to 0
    // mid-edit. The blur flush lands the 0 (four well-formed segments) then.
    const next = compoundLiveWrite(fields, key, text);
    if (next != null && next !== value) onSet(name, next);
  };

  // Blur boundary: flush the buffered field through formatCompound (an empty
  // field coerces to `0` here) and drop the buffer so the field re-reads the
  // value prop. Only fires for the field that actually holds the buffer.
  const flush = (key: keyof CompoundFields) => {
    if (!draft || draft.key !== key) return;
    const next = formatCompound({ ...fields, [key]: draft.text });
    if (next !== value) onSet(name, next);
    setDraft(null);
  };

  return (
    <div className="grid grid-cols-2 gap-1.5">
      {COMPOUND_FIELD_LABELS.map(({ key, label }) => {
        const fieldValue = draft?.key === key ? draft.text : fields[key];
        return (
          <div key={key} className="flex flex-col gap-0.5">
            <span className="text-[10px] text-muted-foreground/80">{label}</span>
            <Input
              value={fieldValue}
              onChange={(e) => change(key, e.currentTarget.value)}
              onBlur={() => flush(key)}
              placeholder={literalOnly ? "0" : "0 or {token}"}
              aria-label={label}
              className={cn(
                "h-7 text-xs",
                !literalOnly && isBoundField(fieldValue) && boundInputClass,
              )}
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * A boolean property (true/false). By default it ALSO accepts a `{token}` (the
 * select carries a token option + a free-text input). When `literalOnly` is set
 * (e.g. `modal`, which the engine reads pre-binding), the token affordance is
 * dropped entirely — just the true/false/default select, no token input.
 */
function BooleanField({
  name,
  value,
  onSet,
  literalOnly,
}: {
  name: string;
  value: string;
  onSet: (name: string, value: string) => void;
  literalOnly?: boolean;
}) {
  const bound = isBoundField(value);

  // Radix's <Select> forbids an empty-string item value, so the "default" (unset)
  // choice rides a sentinel that maps back to "" on write.
  const DEFAULT_OPT = "__default__";

  if (literalOnly) {
    const selected = value === "true" || value === "false" ? value : DEFAULT_OPT;
    return (
      <Select value={selected} onValueChange={(v) => onSet(name, v === DEFAULT_OPT ? "" : v)}>
        <SelectTrigger size="sm" className="w-24 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT_OPT}>default</SelectItem>
          <SelectItem value="true">true</SelectItem>
          <SelectItem value="false">false</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  const selected = bound ? "__token__" : value === "" ? DEFAULT_OPT : value;
  return (
    <div className="flex items-center gap-1.5">
      <Select
        value={selected}
        disabled={bound}
        onValueChange={(v) => {
          if (v === "__token__") return; // keep typing the token in the input
          onSet(name, v === DEFAULT_OPT ? "" : v);
        }}
      >
        <SelectTrigger size="sm" className="w-24 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT_OPT}>default</SelectItem>
          <SelectItem value="true">true</SelectItem>
          <SelectItem value="false">false</SelectItem>
          {bound && <SelectItem value="__token__">{`{token}`}</SelectItem>}
        </SelectContent>
      </Select>
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
  const [query, setQuery] = useState("");
  // Filter by palette name OR its code, case-insensitively, so a long palette is
  // findable by either. Empty query shows everything.
  const q = query.trim().toLowerCase();
  const filtered = q
    ? entries.filter(([n, code]) => n.toLowerCase().includes(q) || code.toLowerCase().includes(q))
    : entries;
  // Preview swatch: a {token} can't preview (no model here), a palette name maps
  // through the palette, and a literal code renders directly.
  const previewCode = bound ? undefined : (palette[value.trim()] ?? value);
  const css = colorCodeToCss(previewCode);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        {/* Reset the search each time the popover closes so it reopens clean. */}
        <Popover onOpenChange={(open) => !open && setQuery("")}>
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
          {/* Bounded to the viewport (never taller than the space Radix reports via
              --radix-popover-content-available-height) with the swatch list as the
              only scroll region, so a long palette scrolls instead of overflowing
              off-screen. collisionPadding keeps it off the very edge. */}
          <PopoverContent
            className="flex max-h-[var(--radix-popover-content-available-height)] w-60 flex-col gap-0 p-2"
            align="start"
            collisionPadding={8}
          >
            <p className="mb-1 shrink-0 font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
              Palette
            </p>
            {entries.length === 0 ? (
              <p className="px-1 py-1 text-muted-foreground text-xs">
                No named colors yet. Add them in the Registry, or type a code below.
              </p>
            ) : (
              <>
                <div className="relative mb-1 shrink-0">
                  <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 size-3 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.currentTarget.value)}
                    placeholder="Search colors…"
                    aria-label="Search palette colors"
                    autoFocus
                    className="h-7 pl-7 text-xs"
                  />
                </div>
                {filtered.length === 0 ? (
                  <p className="px-1 py-2 text-muted-foreground text-xs">
                    No colors match “{query.trim()}”.
                  </p>
                ) : (
                  <div className="-mr-1 grid max-h-56 grid-cols-1 gap-0.5 overflow-y-auto pr-1">
                    {filtered.map(([colorName, code]) => {
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
              </>
            )}
            <p className="mt-2 shrink-0 text-[10px] text-muted-foreground">
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
