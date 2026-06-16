/**
 * EventsPanel — the BOTTOM slice of the structure column (F9c): the `<Event>`
 * registrations of the open component's top-level `<View>`. Each row is one
 * `<Event>` node, edited as a `name` → `handler` pair (the event name, e.g.
 * `Battle:OnCreatureDied`, mapped to the controller function that handles it).
 *
 * Events apply to the `<View>` (design: "Events apply to the <View> (top-level)
 * component"), so they ARE ordinary `<Event>` children of the root in the shared
 * store's `GuiNode` tree:
 *  • ADD appends a fresh blank `<Event>` under the root via `addChildNode`
 *    (reusing the same add path as the F9a tree);
 *  • editing a row's `name`/`handler` writes that node's `attrs` via
 *    `setNodeAttrs`;
 *  • REMOVE detaches the `<Event>` node via `removeNode`.
 * All three mark the component dirty through the store.
 *
 * INTENTIONALLY THIN (design: "Editor's role with events (intentionally thin)"):
 * the editor stores the `name`→`handler` mapping VERBATIM. It does NOT validate
 * that the handler function exists, has no awareness of any event bus, and does no
 * payload modeling. Per-element handler props (`onMouseClicked`, …) are NOT here —
 * those are plain fields on the element in the F9b Properties panel.
 *
 * @see design/xgui_ta.md — "Structure column" (Events) and the events/thin-editor
 *   stance.
 */

import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { GuiNode } from "../../lib/guiNode";
import { useEditorStore } from "./editorState";
import { makeChildNode } from "./guiTreeEdit";

/** The `<Event>` children of the View root, in authored order. */
function eventNodes(root: GuiNode): GuiNode[] {
  return root.children.filter((child) => child.tag === "Event");
}

export function EventsPanel() {
  const { state, dispatch } = useEditorStore();
  const open = state.open;

  if (!open) {
    return (
      <div className="border-t px-3 py-2.5 text-center text-muted-foreground/60 text-xs">
        Open a component to register its events.
      </div>
    );
  }

  const root = open.root;
  const events = eventNodes(root);

  // Append a fresh, blank <Event> under the View root. The user fills name/handler
  // in the row inputs; makeChildNode seeds empty name/handler attrs.
  const addEvent = () => {
    dispatch({ type: "addChildNode", parentNodeId: root.nodeId, child: makeChildNode("Event") });
  };

  // Edit one field of an event row, stored VERBATIM — no validation, no awareness
  // of whether the handler exists. The other field is preserved.
  const setField = (eventNode: GuiNode, key: "name" | "handler", value: string) => {
    dispatch({
      type: "setNodeAttrs",
      nodeId: eventNode.nodeId,
      attrs: { ...eventNode.attrs, [key]: value },
    });
  };

  const removeEvent = (eventNode: GuiNode) => {
    dispatch({ type: "removeNode", nodeId: eventNode.nodeId });
  };

  return (
    <div className="flex min-h-0 flex-col border-t">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Events
        </span>
        <button
          type="button"
          onClick={addEvent}
          className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Plus className="size-3" /> Add
        </button>
      </div>

      <div className="min-h-0 overflow-y-auto px-3 pb-3">
        {events.length === 0 ? (
          <p className="text-muted-foreground/60 text-xs">
            No events registered. Add one to wire a handler to an event name.
          </p>
        ) : (
          <div className="space-y-2">
            {events.map((eventNode) => (
              <EventRow
                key={eventNode.nodeId}
                node={eventNode}
                onSetField={setField}
                onRemove={removeEvent}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** One `<Event>` row: a name input, a handler input, and a remove button. */
function EventRow({
  node,
  onSetField,
  onRemove,
}: {
  node: GuiNode;
  onSetField: (node: GuiNode, key: "name" | "handler", value: string) => void;
  onRemove: (node: GuiNode) => void;
}) {
  return (
    <div className="rounded border bg-muted/20 p-1.5">
      <div className="mb-1 flex items-center gap-1">
        <Input
          value={node.attrs.name ?? ""}
          onChange={(e) => onSetField(node, "name", e.currentTarget.value)}
          placeholder="event name"
          aria-label="event name"
          className="h-7 flex-1 font-mono text-xs"
        />
        <button
          type="button"
          aria-label="Remove event"
          onClick={() => onRemove(node)}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
        >
          <Trash2 className="size-3" />
        </button>
      </div>
      <Input
        value={node.attrs.handler ?? ""}
        onChange={(e) => onSetField(node, "handler", e.currentTarget.value)}
        placeholder="handler function"
        aria-label="handler function"
        className="h-7 font-mono text-xs"
      />
    </div>
  );
}
