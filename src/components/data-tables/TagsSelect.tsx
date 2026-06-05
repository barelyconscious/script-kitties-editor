import { PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Edits a `string[]` constrained to a predefined `options` list. Selected tags
 * show as removable chips; the dropdown toggles membership.
 */
export function TagsSelect({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string[];
  options: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  function toggle(tag: string, on: boolean) {
    onChange(on ? [...value, tag] : value.filter((t) => t !== tag));
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

      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <Button variant="ghost" size="xs" className="text-muted-foreground">
            <PlusIcon /> Tag
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
          {options.map((opt) => (
            <DropdownMenuCheckboxItem
              key={opt}
              checked={value.includes(opt)}
              onCheckedChange={(checked) => toggle(opt, checked)}
              onSelect={(e) => e.preventDefault()}
            >
              {opt}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export default TagsSelect;
