export type TalentMode = "build" | "preview";

/** What's selected on the canvas — at most one kind at a time. `nodes` are the
 *  tree's OWN node ids (placed cluster nodes aren't selectable in Build);
 *  `edge` is an owned link's key; `placement` is a placed cluster. */
export type TalentSelection = {
  nodes: string[];
  edge: string | null;
  note: string | null;
  placement: string | null;
};

export const EMPTY_SELECTION: TalentSelection = {
  nodes: [],
  edge: null,
  note: null,
  placement: null,
};

export const selectNodes = (nodes: string[]): TalentSelection => ({ ...EMPTY_SELECTION, nodes });
export const selectEdge = (edge: string): TalentSelection => ({ ...EMPTY_SELECTION, edge });
export const selectNote = (note: string): TalentSelection => ({ ...EMPTY_SELECTION, note });
export const selectPlacement = (placement: string): TalentSelection => ({
  ...EMPTY_SELECTION,
  placement,
});
