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

import {
  AppWindow,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  LayoutGrid,
  Lock,
  type LucideIcon,
  MonitorPlay,
  Plug,
  Plus,
  Trash2,
  TriangleAlert,
  Type,
  Zap,
} from "lucide-react";
import { ContextMenu } from "radix-ui";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { GuiNode, GuiTag } from "../../lib/guiNode";
import { ComponentPicker } from "./ComponentPicker";
import { useEditorStore } from "./editorState";
import { nodeHasId } from "./guiProperties";
import { allowedChildTags, findNode, makeChildNode, treeNodePrimaryLabel } from "./guiTreeEdit";

/**
 * Per-tag accent color, shared by a row's type icon and its identity label so the
 * element kind reads at a glance. The colored tags (View/Component/Event/Grid) keep
 * their accent; Panel/Text fall back to plain foreground so their id stays readable
 * as the primary label.
 */
function tagColorClass(tag: GuiTag): string {
  switch (tag) {
    case "View":
      return "text-primary";
    case "Component":
      // Aquamarine (slightly desaturated) — distinct from the others without
      // colliding with a semantic color (amber = missing-id warning; plain green =
      // "added" in a diff/VCS).
      return "text-[#86e3c6]";
    case "Event":
      return "text-sky-400";
    case "GridLayout":
      return "text-violet-400";
    default:
      return "text-foreground";
  }
}

/** The type icon shown to the left of each row's label, one per element tag. */
const TAG_ICON: Record<GuiTag, LucideIcon> = {
  // View is a screen (matching the component list's "View" glyph); a Panel is a
  // window/region; a Component plugs in an external piece (plug = plug-in).
  View: MonitorPlay,
  Panel: AppWindow,
  Text: Type,
  Component: Plug,
  Event: Zap,
  GridLayout: LayoutGrid,
};

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
    // Pass the parent's tag so a child added UNDER a GridLayout is created without
    // its own default position/size (the grid owns its child's geometry).
    const parentTag = findNode(open.root, parentNodeId)?.tag;
    dispatch({
      type: "addChildNode",
      parentNodeId,
      child: makeChildNode(tag, undefined, parentTag),
    });
  };

  const handlePickComponent = (basename: string) => {
    if (pickerParentId == null) return;
    const parentTag = findNode(open.root, pickerParentId)?.tag;
    dispatch({
      type: "addChildNode",
      parentNodeId: pickerParentId,
      child: makeChildNode("Component", basename, parentTag),
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
          lockedNodeIds={state.lockedNodeIds}
          hiddenNodeIds={state.hiddenNodeIds}
          onSelect={(nodeId) => dispatch({ type: "select", nodeId })}
          onAdd={handleAdd}
          onRemove={handleRemove}
          onToggleLock={(nodeId) => dispatch({ type: "toggleLock", nodeId })}
          onToggleVisibility={(nodeId) => dispatch({ type: "toggleVisibility", nodeId })}
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
  lockedNodeIds: Set<string>;
  hiddenNodeIds: Set<string>;
  onSelect: (nodeId: string) => void;
  onAdd: (parentNodeId: string, tag: GuiTag) => void;
  onRemove: (nodeId: string) => void;
  onToggleLock: (nodeId: string) => void;
  onToggleVisibility: (nodeId: string) => void;
};

function TreeRow({
  node,
  depth,
  selectedNodeId,
  lockedNodeIds,
  hiddenNodeIds,
  onSelect,
  onAdd,
  onRemove,
  onToggleLock,
  onToggleVisibility,
}: TreeRowProps) {
  const [collapsed, setCollapsed] = useState(false);
  // Whether this row's right-click menu is open. Right-clicking drops the hover
  // highlight, so we hold a highlight on the row for as long as its menu is open —
  // keeping the user anchored to WHICH element they're acting on.
  const [menuOpen, setMenuOpen] = useState(false);
  const hasChildren = node.children.length > 0;
  const tag = node.tag;
  // The row's PRIMARY label is the element's identity (id, or event name), replacing
  // the tag name — the tag is conveyed by the per-tag icon + color instead.
  const { text: label, placeholder: labelPlaceholder } = treeNodePrimaryLabel(node);
  const isEvent = tag === "Event";
  const TagIcon = TAG_ICON[tag];
  const selected = node.nodeId === selectedNodeId;
  // Flag an id-bearing element (Panel/Text/Component) that has no `id`: it can't be
  // referenced from the controller or data bindings, and won't appear in any
  // descendant's computed id path. Newly-added elements are auto-id'd, so this only
  // lights up for imported components or an id the user deliberately cleared — which
  // keeps the warning rare enough to stay trustworthy. Events/View never carry an id.
  const missingId = nodeHasId(tag) && !node.attrs.id?.trim();
  const addable = allowedChildTags(node);
  // Every non-root element is deletable (the root `<View>` is rendered at depth 0
  // and is never removable). Events are just one case of this general delete.
  const removable = depth > 0;
  // Lock / hide are offered on every NON-root element. The root `<View>` is excluded:
  // locking it ("lock everything") or hiding it ("blank the preview") carry no useful
  // meaning, and dropping its icons lets the whole tree reclaim the left gutter.
  const canToggle = depth > 0;
  const locked = lockedNodeIds.has(node.nodeId);
  const hidden = hiddenNodeIds.has(node.nodeId);
  // The row carries a context menu when there's anything to do on it: add a child
  // (containers), lock/hide it, or delete it (any non-root element). These are offered
  // on every row, so the menu is always present.
  const hasMenu = true;

  return (
    <li>
      <ContextMenu.Root onOpenChange={setMenuOpen}>
        <ContextMenu.Trigger asChild>
          <div
            // A row is selected by click and right-clicked to add. The whole row is
            // a button so keyboard focus + Enter selects it.
            className={cn(
              "group flex w-full items-center py-0.5 pr-2 pl-1 text-left text-[13px] transition-colors hover:bg-muted/60",
              // A missing-id element tints the whole row a muted warning color (its
              // type icon is also swapped for a warning glyph below). Selection still
              // wins so the selected row reads clearly; an open right-click menu holds
              // the hover tint so the acted-on row stays visibly anchored.
              selected
                ? "bg-muted"
                : menuOpen
                  ? "bg-muted/60"
                  : missingId && "bg-amber-500/10",
            )}
          >
            {/* Indented row content. Lock/eye no longer occupy a far-left gutter; they
                live in the right-hand affordance group (below) so the tree reclaims the
                horizontal space, and the root `<View>` carries neither. */}
            <div
              className="flex min-w-0 flex-1 items-center gap-1"
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
                {/* Per-tag type icon, left of the identity label, accent-colored —
                    UNLESS the element is missing its id, in which case the warning
                    glyph takes the icon slot (the row is tinted to match). */}
                {missingId ? (
                  <span
                    role="img"
                    title="No id — this element can't be referenced from the controller or data bindings. Give it an id in Properties."
                    aria-label="Missing id"
                    className="shrink-0 text-amber-500"
                  >
                    <TriangleAlert className="size-3" />
                  </span>
                ) : (
                  <TagIcon className={cn("size-3 shrink-0", tagColorClass(tag))} />
                )}
                <span
                  className={cn(
                    "min-w-0 truncate font-medium font-mono",
                    tagColorClass(tag),
                    // An unnamed event's placeholder reads muted/italic so an empty
                    // event is clearly a stub waiting for a name.
                    isEvent && labelPlaceholder && "text-muted-foreground/60 italic",
                  )}
                >
                  {label}
                </span>
              </button>

              {canToggle && (
                // Lock toggle — a right-side affordance. Unlocked: muted, hover-only.
                // Locked: a solid icon that persists even when not hovered, so lock state
                // reads at a glance without a dedicated left column.
                <button
                  type="button"
                  aria-label={locked ? `Unlock ${tag}` : `Lock ${tag}`}
                  aria-pressed={locked}
                  title={
                    locked
                      ? "Locked — can't be selected in the preview or edited. Click to unlock."
                      : "Lock — prevent selection in the preview and edits in Properties."
                  }
                  onClick={() => onToggleLock(node.nodeId)}
                  className={cn(
                    "shrink-0 rounded p-0.5 transition-opacity",
                    locked
                      ? "text-foreground opacity-100"
                      : "text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100",
                  )}
                >
                  <Lock className="size-3" />
                </button>
              )}
              {canToggle && (
                // Visibility toggle — sits beside the lock. Visible: muted, hover-only.
                // Hidden: a persistent slashed eye (EyeOff). Hiding drops the element AND
                // its subtree from the preview.
                <button
                  type="button"
                  aria-label={hidden ? `Show ${tag} in preview` : `Hide ${tag} from preview`}
                  aria-pressed={hidden}
                  title={
                    hidden
                      ? "Hidden from the preview (with its children). Click to show."
                      : "Hide this element (and its children) from the preview."
                  }
                  onClick={() => onToggleVisibility(node.nodeId)}
                  className={cn(
                    "shrink-0 rounded p-0.5 transition-opacity",
                    hidden
                      ? "text-foreground opacity-100"
                      : "text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100",
                  )}
                >
                  {hidden ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                </button>
              )}
              {addable.length > 0 && (
                // A visible add affordance on hover/selection mirrors the right-click
                // menu, so add-child is discoverable without knowing about it.
                <AddMenu node={node} addable={addable} onAdd={onAdd} />
              )}
            </div>
          </div>
        </ContextMenu.Trigger>
        {hasMenu && (
          <ContextMenu.Portal>
            <ContextMenu.Content className="z-50 min-w-40 overflow-hidden rounded-lg bg-popover p-1 text-popover-foreground text-xs shadow-md ring-1 ring-foreground/10">
              {/* Header naming the element the menu acts on. Right-clicking doesn't
                  hold the row's hover highlight, so this keeps the user anchored to
                  WHICH element they opened the menu on. */}
              <ContextMenu.Label className="flex items-center gap-1.5 px-2 py-1">
                {missingId ? (
                  <TriangleAlert className="size-3 shrink-0 text-amber-500" />
                ) : (
                  <TagIcon className={cn("size-3 shrink-0", tagColorClass(tag))} />
                )}
                <span
                  className={cn(
                    "min-w-0 truncate font-medium font-mono",
                    tagColorClass(tag),
                    isEvent && labelPlaceholder && "text-muted-foreground/60 italic",
                  )}
                >
                  {label}
                </span>
              </ContextMenu.Label>
              <ContextMenu.Separator className="my-1 h-px bg-border" />
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
                  {/* Separate the Add group from the element-level actions below
                      (lock/hide/delete) so they don't read as one undifferentiated list. */}
                  {(canToggle || removable) && (
                    <ContextMenu.Separator className="my-1 h-px bg-border" />
                  )}
                </>
              )}
              {canToggle && (
                <>
                  <ContextMenu.Item
                    onSelect={() => onToggleLock(node.nodeId)}
                    className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 outline-none data-[highlighted]:bg-muted"
                  >
                    <Lock className="size-3" /> {locked ? "Unlock" : "Lock"}
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    onSelect={() => onToggleVisibility(node.nodeId)}
                    className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 outline-none data-[highlighted]:bg-muted"
                  >
                    {hidden ? <Eye className="size-3" /> : <EyeOff className="size-3" />}{" "}
                    {hidden ? "Show in preview" : "Hide from preview"}
                  </ContextMenu.Item>
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
              lockedNodeIds={lockedNodeIds}
              hiddenNodeIds={hiddenNodeIds}
              onSelect={onSelect}
              onAdd={onAdd}
              onRemove={onRemove}
              onToggleLock={onToggleLock}
              onToggleVisibility={onToggleVisibility}
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
