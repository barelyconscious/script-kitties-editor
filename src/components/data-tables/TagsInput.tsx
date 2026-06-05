import { XIcon } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { Input } from "@/components/ui/input";

/**
 * Edits a `string[]` as removable chips. Add a tag with Enter or comma;
 * Backspace on an empty input removes the last tag.
 */
export function TagsInput({
  value,
  onChange,
  disabled,
  placeholder = "Add tag…",
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  function commit(raw: string) {
    const tag = raw.trim();
    if (!tag) return;
    if (!value.includes(tag)) onChange([...value, tag]);
    setDraft("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(draft);
    } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border border-input bg-transparent p-1 shadow-xs focus-within:ring-2 focus-within:ring-ring/50">
      {value.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 font-medium text-muted-foreground text-xs"
        >
          {tag}
          {!disabled && (
            <button
              type="button"
              onClick={() => onChange(value.filter((t) => t !== tag))}
              className="text-muted-foreground/60 hover:text-foreground"
              aria-label={`Remove ${tag}`}
            >
              <XIcon className="size-3" />
            </button>
          )}
        </span>
      ))}
      <Input
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => commit(draft)}
        placeholder={value.length === 0 ? placeholder : ""}
        className="h-6 flex-1 border-0 px-1 shadow-none focus-visible:ring-0"
      />
    </div>
  );
}

export default TagsInput;
