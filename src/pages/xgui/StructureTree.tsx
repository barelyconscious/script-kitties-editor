/**
 * StructureTree — the TOP slice of the structure column (F9a): the open
 * component's {@link GuiNode} hierarchy rendered as a tree keyed by `nodeId`, with
 * selection synced to the preview and a right-click "add child" menu.
 *
 * Selection: clicking a tree row dispatches `select` into the SHARED editor store,
 * and the row highlights when its `nodeId` matches `state.selectedNodeId`. The
 * preview reads/writes the SAME `selectedNodeId` (see {@link GuiPreviewHost}), so a
 * click in either surface highlights both — there is exactly one selection.
 *
 * Add child: right-clicking a row opens a context menu offering only the tags the
 * element rules permit under that node ({@link allowedChildTags} — Component is
 * childless, Event only under View). Picking a non-Component tag dispatches
 * `addChildNode` immediately; picking Component opens the {@link ComponentPicker}
 * and adds once the user chooses a basename for `src`. Both mutate the store's tree
 * (so the preview updates) and select the new node.
 *
 * Delete: every NON-ROOT row carries a delete affordance (right-click "Delete" /
 * an inline trash button) wired to the store's `removeNode` action, which removes
 * the element AND its whole subtree. The root `<View>` is never deletable. Deletion
 * goes through the document history, so Cmd+Z restores it; a selection the removal
 * orphans is cleared by the reducer. `<Event>` rows are just one case of this
 * general delete (their affordance reads "Remove event").
 *
 * @see design/xgui_ta.md — "Structure column" (tree slice) and "Selection model".
 */

import { ChevronDown, ChevronRight, Plus, Trash2, TriangleAlert } from "lucide-react";
import { ContextMenu } from "radix-ui";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { GuiNode, GuiTag } from "../../lib/guiNode";
import { ComponentPicker } from "./ComponentPicker";
import { useEditorStore } from "./editorState";
import { nodeHasId } from "./guiProperties";
import { allowedChildTags, EVENT_PLACEHOLDER_LABEL, makeChildNode, nodeLabel } from "./guiTreeEdit";

/** Per-tag accent for the tag chip, so the tree reads at a glance. */
function tagChipClass(tag: GuiTag): string {
  switch (tag) {
    case "View":
      return "text-primary";
    case "Component":
      return "text-amber-400";
    case "Event":
      return "text-sky-400";
    default:
      return "text-muted-foreground";
  }
}

export function StructureTree() {
  const { state, dispatch } = useEditorStore();
  const open = state.open;
  // The parent a Component is being added under, while the picker is open. `null`
  // means the picker is closed.
  const [pickerParentId, setPickerParentId] = useState<string | null>(null);

  if (!open) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-center text-muted-foreground text-xs">
        Open a component to see its element tree.
      </div>
    );
  }

  const selectedNodeId = state.selectedNodeId;

  const handleAdd = (parentNodeId: string, tag: GuiTag) => {
    if (tag === "Component") {
      // Defer the actual add until the user picks a src basename.
      setPickerParentId(parentNodeId);
      return;
    }
    dispatch({ type: "addChildNode", parentNodeId, child: makeChildNode(tag) });
  };

  const handlePickComponent = (basename: string) => {
    if (pickerParentId == null) return;
    dispatch({
      type: "addChildNode",
      parentNodeId: pickerParentId,
      child: makeChildNode("Component", basename),
    });
    setPickerParentId(null);
  };

  // Remove a node (and its whole subtree) from the tree via the history-tracked
  // `removeNode` action. Exposed on every non-root row; the root `<View>` is guarded
  // both here (the pure `removeNode` no-ops on the root) and at the affordance level
  // (no trash/menu item is rendered for the root).
  const handleRemove = (nodeId: string) => {
    dispatch({ type: "removeNode", nodeId });
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto py-1">
      <ul>
        <TreeRow
          node={open.root}
          depth={0}
          selectedNodeId={selectedNodeId}
          onSelect={(nodeId) => dispatch({ type: "select", nodeId })}
          onAdd={handleAdd}
          onRemove={handleRemove}
        />
      </ul>

      <ComponentPicker
        open={pickerParentId != null}
        onOpenChange={(o) => {
          if (!o) setPickerParentId(null);
        }}
        onPick={handlePickComponent}
        excludeName={open.name}
      />
    </div>
  );
}

/** Indentation step per tree level, in rem. */
const INDENT_REM = 0.75;

type TreeRowProps = {
  node: GuiNode;
  depth: number;
  selectedNodeId: string | null;
  onSelect: (nodeId: string) => void;
  onAdd: (parentNodeId: string, tag: GuiTag) => void;
  onRemove: (nodeId: string) => void;
};

function TreeRow({ node, depth, selectedNodeId, onSelect, onAdd, onRemove }: TreeRowProps) {
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = node.children.length > 0;
  const { tag, secondary } = nodeLabel(node);
  // Events label by name (no `#` prefix); other tags prefix their id with `#`.
  const isEvent = tag === "Event";
  const selected = node.nodeId === selectedNodeId;
  // Flag an id-bearing element (Panel/Text/Component) that has no `id`: it can't be
  // referenced from the controller or data bindings, and won't appear in any
  // descendant's computed id path. Newly-added elements are auto-id'd, so this only
  // lights up for imported components or an id the user deliberately cleared — which
  // keeps the warning rare enough to stay trustworthy. Events/View never carry an id.
  const missingId = nodeHasId(tag) && !node.attrs.id?.trim();
  const addable = allowedChildTags(tag);
  // Every non-root element is deletable (the root `<View>` is rendered at depth 0
  // and is never removable). Events are just one case of this general delete.
  const removable = depth > 0;
  // The row carries a context menu when there's anything to do on it: add a child
  // (containers) or delete it (any non-root element).
  const hasMenu = addable.length > 0 || removable;

  return (
    <li>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <div
            // A row is selected by click and right-clicked to add. The whole row is
            // a button so keyboard focus + Enter selects it.
            className={cn(
              "group flex w-full items-center gap-1 py-0.5 pr-2 text-left text-xs transition-colors hover:bg-muted/60",
              selected && "bg-muted",
            )}
            style={{ paddingLeft: `${0.25 + depth * INDENT_REM}rem` }}
          >
            {hasChildren ? (
              <button
                type="button"
                aria-label={collapsed ? "Expand" : "Collapse"}
                onClick={() => setCollapsed((c) => !c)}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                {collapsed ? (
                  <ChevronRight className="size-3" />
                ) : (
                  <ChevronDown className="size-3" />
                )}
              </button>
            ) : (
              <span className="inline-block size-4 shrink-0" />
            )}

            <button
              type="button"
              onClick={() => onSelect(node.nodeId)}
              className="flex min-w-0 flex-1 select-none items-center gap-1.5 text-left"
            >
              <span className={cn("shrink-0 font-medium font-mono", tagChipClass(tag))}>{tag}</span>
              {secondary && (
                <span
                  className={cn(
                    "min-w-0 truncate text-muted-foreground",
                    // The placeholder for an unnamed event reads as muted/italic so an
                    // empty event is clearly a stub waiting for a name.
                    isEvent &&
                      secondary === EVENT_PLACEHOLDER_LABEL &&
                      "text-muted-foreground/60 italic",
                  )}
                >
                  {isEvent ? secondary : `#${secondary}`}
                </span>
              )}
              {tag === "Component" && node.attrs.src && (
                <span className="min-w-0 truncate text-muted-foreground/70 italic">
                  {node.attrs.src}
                </span>
              )}
            </button>

            {missingId && (
              // Always-visible status flag (not hover-gated): this element has no id,
              // so it isn't addressable. The title spells out the consequence.
              <span
                role="img"
                title="No id — this element can't be referenced from the controller or data bindings. Give it an id in Properties."
                aria-label="Missing id"
                className="shrink-0 text-amber-500"
              >
                <TriangleAlert className="size-3" />
              </span>
            )}

            {removable && (
              // A visible delete affordance on hover mirrors the right-click menu, so
              // deleting an element is discoverable without knowing the context menu.
              <button
                type="button"
                aria-label={isEvent ? "Remove event" : `Delete ${tag}`}
                onClick={() => onRemove(node.nodeId)}
                className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              >
                <Trash2 className="size-3" />
              </button>
            )}
            {addable.length > 0 && (
              // A visible add affordance on hover/selection mirrors the right-click
              // menu, so add-child is discoverable without knowing about it.
              <AddMenu node={node} addable={addable} onAdd={onAdd} />
            )}
          </div>
        </ContextMenu.Trigger>
        {hasMenu && (
          <ContextMenu.Portal>
            <ContextMenu.Content className="z-50 min-w-40 overflow-hidden rounded-lg bg-popover p-1 text-popover-foreground text-xs shadow-md ring-1 ring-foreground/10">
              {addable.length > 0 && (
                <>
                  <ContextMenu.Label className="px-2 py-1 text-muted-foreground">
                    Add child
                  </ContextMenu.Label>
                  {addable.map((childTag) => (
                    <ContextMenu.Item
                      key={childTag}
                      onSelect={() => onAdd(node.nodeId, childTag)}
                      className="cursor-pointer rounded px-2 py-1 outline-none data-[highlighted]:bg-muted"
                    >
                      {`<${childTag}>`}
                      {childTag === "Component" && (
                        <span className="ml-1 text-muted-foreground">…</span>
                      )}
                    </ContextMenu.Item>
                  ))}
                </>
              )}
              {removable && (
                <ContextMenu.Item
                  onSelect={() => onRemove(node.nodeId)}
                  className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-destructive outline-none data-[highlighted]:bg-muted"
                >
                  <Trash2 className="size-3" /> {isEvent ? "Remove event" : "Delete"}
                </ContextMenu.Item>
              )}
            </ContextMenu.Content>
          </ContextMenu.Portal>
        )}
      </ContextMenu.Root>

      {hasChildren && !collapsed && (
        <ul>
          {node.children.map((child) => (
            <TreeRow
              key={child.nodeId}
              node={child}
              depth={depth + 1}
              selectedNodeId={selectedNodeId}
              onSelect={onSelect}
              onAdd={onAdd}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The inline "+" add-child button — a click-opened dropdown mirroring the
 * right-click context menu, so add-child is discoverable. Built on the same
 * radix ContextMenu? No — a click menu uses DropdownMenu semantics; here we use a
 * tiny popover-like menu via the native details/summary-free approach: reuse the
 * context menu's item list by triggering it as a small inline menu.
 */
function AddMenu({
  node,
  addable,
  onAdd,
}: {
  node: GuiNode;
  addable: GuiTag[];
  onAdd: (parentNodeId: string, tag: GuiTag) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-label="Add child"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100",
          open && "opacity-100",
        )}
      >
        <Plus className="size-3" />
      </button>
      {open && (
        <>
          {/* Click-away catcher. */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: invisible click-away backdrop for a lightweight inline menu */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop is dismiss-only; Escape handled by focus leaving */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 min-w-36 overflow-hidden rounded-lg bg-popover p-1 text-popover-foreground text-xs shadow-md ring-1 ring-foreground/10">
            <p className="px-2 py-1 text-muted-foreground">Add child</p>
            {addable.map((childTag) => (
              <button
                key={childTag}
                type="button"
                onClick={() => {
                  onAdd(node.nodeId, childTag);
                  setOpen(false);
                }}
                className="block w-full cursor-pointer rounded px-2 py-1 text-left hover:bg-muted"
              >
                {`<${childTag}>`}
                {childTag === "Component" && <span className="ml-1 text-muted-foreground">…</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
