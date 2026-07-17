import { useEffect, useMemo, useState } from "react";
import { Sprite } from "@/components/Sprite";
import { loadSpriteNames, useSpriteNamesVersion } from "@/components/spriteNamesCache";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function SpritePicker({
  value,
  onChange,
  disabled,
  container,
}: {
  value: string;
  onChange: (name: string) => void;
  disabled?: boolean;
  /** Portal target — pass the host dialog's content node so the grid scrolls. */
  container?: HTMLElement | null;
}) {
  const [open, setOpen] = useState(false);
  const [names, setNames] = useState<string[] | null>(null);
  const [query, setQuery] = useState("");
  // Bumped when the shared name cache is cleared (e.g. an asset rescan); threaded into
  // the fetch deps so an open picker re-fetches the fresh list, and a closed one picks
  // it up on its next open (the cleared cache re-fetches instead of serving the memo).
  const namesVersion = useSpriteNamesVersion();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    loadSpriteNames().then((n) => !cancelled && setNames(n));
    return () => {
      cancelled = true;
    };
  }, [open, namesVersion]);

  const filtered = useMemo(() => {
    if (!names) return [];
    const q = query.trim().toLowerCase();
    return q ? names.filter((n) => n.toLowerCase().includes(q)) : names;
  }, [names, query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="flex h-8.25 w-full items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 text-left text-sm shadow-xs hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
        >
          <Sprite name={value} className="size-5 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {value || "Choose sprite…"}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start" container={container}>
        <div className="border-b p-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="Search sprites…"
            className="h-8"
            autoFocus
          />
        </div>
        <div className="grid max-h-64 grid-cols-5 gap-1 overflow-y-auto p-2">
          {names === null ? (
            <p className="col-span-5 p-2 text-center text-muted-foreground text-xs">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="col-span-5 p-2 text-center text-muted-foreground text-xs">
              No sprites match “{query}”.
            </p>
          ) : (
            filtered.map((n) => (
              <button
                key={n}
                type="button"
                title={n}
                onClick={() => {
                  onChange(n);
                  setOpen(false);
                }}
                className={cn(
                  "flex aspect-square items-center justify-center rounded-sm border p-1 hover:bg-muted",
                  n === value ? "border-ring ring-2 ring-ring/50" : "border-transparent",
                )}
              >
                <Sprite name={n} lazy className="size-full" />
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default SpritePicker;
