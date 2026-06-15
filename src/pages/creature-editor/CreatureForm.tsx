import type { Creature } from "@/lib/creature";
import { AbilitiesByLevelEditor } from "./AbilitiesByLevelEditor";
import { type AbilityOption, AbilityPicker } from "./AbilityPicker";
import { ProgressionChart } from "./ProgressionChart";
import { StatGrowthTable } from "./StatGrowthTable";
import { StatGrowthTableSingle } from "./StatGrowthTableSingle";

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="font-medium text-sm">{title}</h3>
        {description && <p className="text-muted-foreground text-xs">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * The editing surface for a single creature: identity, base abilities, the
 * stat/growth grid, per-level unlocks, and the live progression chart. Pure —
 * all state lives in the parent, which owns dirty tracking and saving.
 */
export function CreatureForm({
  creature,
  population,
  abilityOptions,
  onChange,
  disabled,
  showProgressionChart = true,
  singleColumnStats = false,
  onStatFocus,
}: {
  creature: Creature;
  population: Creature[];
  abilityOptions: AbilityOption[];
  onChange: (next: Creature) => void;
  disabled?: boolean;
  /**
   * Whether to render the progression chart section. Defaults to `true` so the
   * standalone Creature Editor (the balance surface) keeps it. The Workbench's
   * creature DATA pane passes `false` — that pane is the code-and-data lens, not
   * the balance surface.
   */
  showProgressionChart?: boolean;
  /**
   * Render the stats & growth grid as ONE full-width table instead of the
   * two-up split. The standalone editor is wide enough for the split; the
   * Workbench's fixed-width DATA pane passes `true` so the rows aren't squished.
   */
  singleColumnStats?: boolean;
  /**
   * Notified with a stat key when one of its value boxes gains focus, so a host
   * (the Workbench) can sync an external progression chart to that stat. Only
   * wired for the single-column grid.
   */
  onStatFocus?: (stat: string) => void;
}) {
  const set = <K extends keyof Creature>(key: K, value: Creature[K]) =>
    onChange({ ...creature, [key]: value });

  return (
    <div className="flex flex-col gap-8">
      {showProgressionChart && (
        <Section
          title="Progression"
          description="Projected growth versus the average and max across all creatures."
        >
          <ProgressionChart creature={creature} population={population} />
        </Section>
      )}

      <Section
        title="Stats & growth"
        description="Level-1 base value and the flat amount each stat gains per level."
      >
        {singleColumnStats ? (
          <StatGrowthTableSingle
            creature={creature}
            onChange={onChange}
            disabled={disabled}
            onStatFocus={onStatFocus}
          />
        ) : (
          <StatGrowthTable creature={creature} onChange={onChange} disabled={disabled} />
        )}
      </Section>

      <Section title="Base abilities" description="Abilities the creature knows from level 1.">
        <AbilityPicker
          value={creature.baseAbilities}
          options={abilityOptions}
          onChange={(v) => set("baseAbilities", v)}
          disabled={disabled}
        />
      </Section>

      <Section
        title="Level-up unlocks"
        description="Extra abilities granted when the creature reaches a given level."
      >
        <AbilitiesByLevelEditor
          value={creature.abilitiesByLevel}
          abilityOptions={abilityOptions}
          onChange={(v) => set("abilitiesByLevel", v)}
          disabled={disabled}
        />
      </Section>
    </div>
  );
}

export default CreatureForm;
