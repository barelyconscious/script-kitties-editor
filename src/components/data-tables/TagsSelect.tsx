import { CheckIcon, PlusIcon, XIcon } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { normalizeToken } from "@/lib/registry";
import { cn } from "@/lib/utils";

/**
 * Edits a `string[]` drawn from a predefined `options` list. Selected tags show
 * as removable chips; the popover filters and toggles membership.
 *
 * When `onCreateOption` is supplied, a value not already in `options` can be
 * created inline: it's normalized to `UPPER_SNAKE_CASE`, added to the selection,
 * AND handed to `onCreateOption` so it can be persisted to the shared Registry.
 * The create row spells this out ("Add … to registry") so it's clear the new
 * tag becomes a first-class option everywhere, not a one-off free-form string.
 */
export function TagsSelect({
  value,
  options,
  onChange,
  onCreateOption,
  disabled,
  container,
}: {
  value: string[];
  options: string[];
  onChange: (next: string[]) => void;
  onCreateOption?: (value: string) => void;
  disabled?: boolean;
  container?: HTMLElement | null;
}) {
  const [draft, setDraft] = useState("");

  function toggle(tag: string, on: boolean) {
    onChange(on ? [...value, tag] : value.filter((t) => t !== tag));
  }

  const query = draft.trim().toUpperCase();
  const filtered = query ? options.filter((o) => o.toUpperCase().includes(query)) : options;

  // The normalized token a create action would add — shown only when it isn't
  // already a known option (creating a duplicate is meaningless).
  const token = normalizeToken(draft);
  const canCreate = !!onCreateOption && token !== "" && !options.some((o) => o === token);

  function create() {
    if (!canCreate) return;
    if (!value.includes(token)) onChange([...value, token]);
    onCreateOption?.(token);
    setDraft("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      // Enter creates a new tag, or — if the text exactly matches one filtered
      // option — toggles that option on.
      if (canCreate) {
        create();
      } else {
        const exact = filtered.find((o) => o.toUpperCase() === query);
        if (exact && !value.includes(exact)) {
          toggle(exact, true);
          setDraft("");
        }
      }
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border border-input bg-transparent p-1 shadow-xs">
      {value.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 font-medium text-muted-foreground text-xs"
        >
          {tag}
          {!disabled && (
            <button
              type="button"
              onClick={() => toggle(tag, false)}
              className="text-muted-foreground/60 hover:text-foreground"
              aria-label={`Remove ${tag}`}
            >
              <XIcon className="size-3" />
            </button>
          )}
        </span>
      ))}

      <Popover>
        <PopoverTrigger asChild disabled={disabled}>
          <Button variant="ghost" size="xs" className="text-muted-foreground">
            <PlusIcon /> Tag
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" container={container} className="w-64 gap-0 p-1">
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            placeholder={onCreateOption ? "Filter or add a tag…" : "Filter tags…"}
            className="mb-1 h-7"
          />

          <div className="max-h-56 overflow-y-auto">
            {filtered.map((opt) => {
              const checked = value.includes(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => toggle(opt, !checked)}
                  className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm outline-hidden hover:bg-accent hover:text-accent-foreground"
                >
                  <CheckIcon className={cn("size-4 shrink-0", !checked && "opacity-0")} />
                  {opt}
                </button>
              );
            })}
            {filtered.length === 0 && !canCreate && (
              <p className="px-1.5 py-1 text-muted-foreground text-xs">No matching tags.</p>
            )}
          </div>

          {canCreate && (
            <button
              type="button"
              onClick={create}
              className="mt-1 flex w-full items-center gap-1.5 rounded-md border-t px-1.5 py-1.5 text-left text-sm outline-hidden hover:bg-accent hover:text-accent-foreground"
            >
              <PlusIcon className="size-4 shrink-0" />
              <span className="flex flex-col">
                <span>
                  Add <span className="font-medium">{token}</span>
                </span>
                <span className="text-muted-foreground text-xs">
                  Creates a new tag in the registry
                </span>
              </span>
            </button>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

export default TagsSelect;
