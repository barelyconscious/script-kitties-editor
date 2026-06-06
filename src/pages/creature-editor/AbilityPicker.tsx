import { CheckIcon, PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type AbilityOption = { id: string; name: string };

/**
 * Edits a list of ability ids constrained to a known set, showing each by its
 * human name. Selected abilities render as removable chips; the popover offers a
 * searchable, toggleable list. Built for the creature editor's base abilities
 * and per-level unlocks, where the underlying value is `string[]` of ids.
 */
export function AbilityPicker({
  value,
  options,
  onChange,
  disabled,
  placeholder = "Add ability",
}: {
  value: string[];
  options: AbilityOption[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const nameOf = (id: string) => options.find((o) => o.id === id)?.name ?? id;

  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => o.name.toLowerCase().includes(q) || o.id.toLowerCase().includes(q))
    : options;

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border border-input bg-transparent p-1 shadow-xs">
      {value.map((id) => (
        <span
          key={id}
          className="inline-flex items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 font-medium text-muted-foreground text-xs"
        >
          {nameOf(id)}
          {!disabled && (
            <button
              type="button"
              onClick={() => toggle(id)}
              className="text-muted-foreground/60 hover:text-foreground"
              aria-label={`Remove ${nameOf(id)}`}
            >
              <XIcon className="size-3" />
            </button>
          )}
        </span>
      ))}

      <Popover onOpenChange={(open) => !open && setQuery("")}>
        <PopoverTrigger asChild disabled={disabled}>
          <Button variant="ghost" size="xs" className="text-muted-foreground">
            <PlusIcon /> {placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-1">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="Search abilities…"
            className="mb-1 h-8"
          />
          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-2 py-1.5 text-muted-foreground text-xs">No matches.</p>
            ) : (
              filtered.map((o) => {
                const selected = value.includes(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => toggle(o.id)}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
                  >
                    <CheckIcon className={cn("size-3.5", !selected && "opacity-0")} />
                    <span className="flex-1 truncate">{o.name}</span>
                  </button>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export default AbilityPicker;
