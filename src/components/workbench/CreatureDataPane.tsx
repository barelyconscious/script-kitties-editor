import { FileWarning, Loader2 } from "lucide-react";
import { populationWithDraft } from "@/lib/creature";
import { CreatureForm } from "@/pages/creature-editor/CreatureForm";
import { CreatureIdentityFields } from "@/pages/creature-editor/CreatureIdentityFields";
import { useCreatureTab } from "./creatureTab";

/**
 * The DATA pane for a CREATURE tab: identity fields plus the SAME
 * {@link CreatureForm} the standalone editor used (stat grid, per-level unlocks,
 * base abilities). State lives in the surrounding {@link CreatureTabProvider} —
 * this pane is a pure consumer, so its edits flow straight to the shared draft
 * the Stats-graph pane reads. Focusing a stat box reports the stat up via
 * `setActiveStat` so the chart follows.
 *
 * The progression chart is suppressed here (`showProgressionChart={false}`): in
 * the Workbench the chart is the center pane's Stats view, not part of this form.
 */
export function CreatureDataPane() {
  const { state, draft, setDraft, population, abilities, saving, saveError, setActiveStat } =
    useCreatureTab();

  if (state.kind === "loading") {
    return (
      <PaneStatus>
        <Loader2 className="size-4 animate-spin" />
        Loading…
      </PaneStatus>
    );
  }
  if (state.kind === "error") {
    return (
      <PaneStatus>
        <FileWarning className="size-5 text-amber-500" />
        <span className="font-medium text-foreground">Could not load this creature.</span>
        <span className="text-xs">{state.message}</span>
      </PaneStatus>
    );
  }
  if (state.kind === "notFound" || !draft) {
    return (
      <PaneStatus>
        <FileWarning className="size-5 text-amber-500" />
        <span>This creature could not be found.</span>
      </PaneStatus>
    );
  }

  // Scroll + padding are owned by the enclosing Pane (it wraps children in an
  // `overflow-auto p-3` region), so this pane only lays out its own content.
  return (
    <div className="flex flex-col gap-3">
      {saveError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-destructive text-sm">
          {saveError}
        </div>
      )}
      <div className="flex flex-col gap-8">
        {/* Identity section, matching CreatureForm's Section heading style so it
            reads as the first section, then stats/growth/abilities follow. */}
        <section className="flex flex-col gap-3">
          <div>
            <h3 className="font-medium text-sm">Details</h3>
            <p className="text-muted-foreground text-xs">
              Name, sprite, and description. The script pointer lives in the SCRIPT pane.
            </p>
          </div>
          <CreatureIdentityFields creature={draft} onChange={setDraft} disabled={saving} />
        </section>

        <CreatureForm
          creature={draft}
          population={populationWithDraft(population, draft)}
          abilityOptions={abilities}
          onChange={setDraft}
          disabled={saving}
          showProgressionChart={false}
          singleColumnStats
          onStatFocus={setActiveStat}
        />
      </div>
    </div>
  );
}

function PaneStatus({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground text-sm">
      {children}
    </div>
  );
}

export default CreatureDataPane;
