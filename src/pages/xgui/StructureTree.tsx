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
 * SCOPE (F9a): ADD only. There is no delete/reparent affordance here — those are
 * deferred (task 452 / design subsection 2).
 *
 * @see design/xgui_ta.md — "Structure column" (tree slice) and "Selection model".
 */

import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { ContextMenu } from "radix-ui";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { GuiNode, GuiTag } from "../../lib/guiNode";
import { ComponentPicker } from "./ComponentPicker";
import { useEditorStore } from "./editorState";
import { allowedChildTags, makeChildNode } from "./guiTreeEdit";

/** A short label for an element row: its tag plus its authored `id` if present. */
function nodeLabel(node: GuiNode): { tag: GuiTag; id: string | null } {
  const id = node.attrs.id?.trim();
  return { tag: node.tag, id: id ? id : null };
}

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

  return (
    <div className="min-h-0 flex-1 overflow-y-auto py-1">
      <ul>
        <TreeRow
          node={open.root}
          depth={0}
          selectedNodeId={selectedNodeId}
          onSelect={(nodeId) => dispatch({ type: "select", nodeId })}
          onAdd={handleAdd}
        />
      </ul>

      <ComponentPicker
        open={pickerParentId != null}
        onOpenChange={(o) => {
          if (!o) setPickerParentId(null);
        }}
        onPick={handlePickComponent}
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
};

function TreeRow({ node, depth, selectedNodeId, onSelect, onAdd }: TreeRowProps) {
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = node.children.length > 0;
  const { tag, id } = nodeLabel(node);
  const selected = node.nodeId === selectedNodeId;
  const addable = allowedChildTags(tag);

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
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            >
              <span className={cn("shrink-0 font-medium font-mono", tagChipClass(tag))}>{tag}</span>
              {id && <span className="min-w-0 truncate text-muted-foreground">#{id}</span>}
              {tag === "Component" && node.attrs.src && (
                <span className="min-w-0 truncate text-muted-foreground/70 italic">
                  {node.attrs.src}
                </span>
              )}
            </button>

            {addable.length > 0 && (
              // A visible add affordance on hover/selection mirrors the right-click
              // menu, so add-child is discoverable without knowing about it.
              <AddMenu node={node} addable={addable} onAdd={onAdd} />
            )}
          </div>
        </ContextMenu.Trigger>
        {addable.length > 0 && (
          <ContextMenu.Portal>
            <ContextMenu.Content className="z-50 min-w-40 overflow-hidden rounded-lg bg-popover p-1 text-popover-foreground text-xs shadow-md ring-1 ring-foreground/10">
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
