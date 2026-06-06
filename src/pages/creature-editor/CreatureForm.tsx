import { SpritePicker } from "@/components/data-tables/SpritePicker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Creature } from "@/lib/creature";
import { AbilitiesByLevelEditor } from "./AbilitiesByLevelEditor";
import { type AbilityOption, AbilityPicker } from "./AbilityPicker";
import { ProgressionChart } from "./ProgressionChart";
import { StatGrowthTable } from "./StatGrowthTable";

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
}: {
  creature: Creature;
  population: Creature[];
  abilityOptions: AbilityOption[];
  onChange: (next: Creature) => void;
  disabled?: boolean;
}) {
  const set = <K extends keyof Creature>(key: K, value: Creature[K]) =>
    onChange({ ...creature, [key]: value });

  return (
    <div className="flex flex-col gap-8">
      <Section title="Identity">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="creature-name" className="text-xs">
              Name
            </Label>
            <Input
              id="creature-name"
              value={creature.name}
              disabled={disabled}
              onChange={(e) => set("name", e.currentTarget.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="creature-sprite" className="text-xs">
              Sprite
            </Label>
            <SpritePicker
              value={creature.sprite}
              disabled={disabled}
              onChange={(name) => set("sprite", name)}
            />
          </div>
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="creature-script" className="text-xs">
              Script
            </Label>
            <Input
              id="creature-script"
              value={creature.aiController}
              disabled={disabled}
              onChange={(e) => set("aiController", e.currentTarget.value)}
            />
          </div>
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="creature-description" className="text-xs">
              Description
            </Label>
            <Textarea
              id="creature-description"
              value={creature.description}
              rows={3}
              disabled={disabled}
              onChange={(e) => set("description", e.currentTarget.value)}
            />
          </div>
        </div>
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
        title="Stats & growth"
        description="Level-1 base value and the flat amount each stat gains per level."
      >
        <StatGrowthTable creature={creature} onChange={onChange} disabled={disabled} />
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

      <Section
        title="Progression"
        description="Projected growth versus the average and max across all creatures."
      >
        <ProgressionChart creature={creature} population={population} />
      </Section>
    </div>
  );
}

export default CreatureForm;
