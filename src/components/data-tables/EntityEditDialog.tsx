import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { SpritePicker } from "./SpritePicker";
import { TagsInput } from "./TagsInput";
import { TagsSelect } from "./TagsSelect";

/**
 * A single editable field in an entity edit form.
 *
 * `kind` drives which control renders. `custom` is the escape hatch for shapes
 * the built-in kinds don't cover (e.g. a charm's stats map) — supply `render`.
 */
export type EntityField<T> = {
  key: Extract<keyof T, string>;
  label: string;
  kind: "text" | "textarea" | "number" | "tags" | "sprite" | "select" | "custom";
  /** Read-only fields (e.g. the id, which is the primary key) render disabled. */
  readOnly?: boolean;
  /** Span both columns of the form grid (good for textareas / tags). */
  full?: boolean;
  /** Choices for `select`, and the allowed set for `tags` (free-form if omitted). */
  options?: string[];
  /** Step for `number` fields. Use "any" to allow decimals (e.g. cost). */
  step?: number | "any";
  /** Required when `kind` is "custom". */
  render?: (args: {
    value: T[Extract<keyof T, string>];
    setValue: (v: T[Extract<keyof T, string>]) => void;
    draft: T;
    disabled: boolean;
  }) => ReactNode;
};

/**
 * Generic, schema-driven edit dialog. Owns draft state, dirty tracking, the
 * save lifecycle (in-flight + error), and cancel. Entity-specific knowledge
 * lives entirely in the `fields` schema passed by the caller, so the same
 * dialog edits abilities, items, biograms, etc.
 */
export function EntityEditDialog<T extends { id: string }>({
  entity,
  fields,
  title,
  description,
  onOpenChange,
  onSave,
}: {
  /** The row being edited, or `null` when the dialog is closed. */
  entity: T | null;
  fields: EntityField<T>[];
  title?: string;
  description?: string;
  onOpenChange: (open: boolean) => void;
  /** Persist the edited entity. Throw to surface an error and keep the dialog open. */
  onSave: (updated: T) => Promise<void>;
}) {
  const [draft, setDraft] = useState<T | null>(entity);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Portal target for nested pickers (sprite picker). Pointing their popovers
  // here — inside DialogContent — keeps them within the dialog's scroll-lock
  // subtree so their internal scrolling works.
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);

  // Reset the draft whenever a different entity is opened.
  useEffect(() => {
    setDraft(entity);
    setError(null);
  }, [entity]);

  const dirty = !!draft && !!entity && !shallowEqual(draft, entity);

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      onOpenChange(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={entity !== null} onOpenChange={(open) => !open && onOpenChange(false)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title ?? "Edit"}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {draft && (
          <div className="grid max-h-[60vh] grid-cols-2 gap-x-4 gap-y-3 overflow-y-auto px-1 py-1">
            {fields.map((field) => {
              const value = draft[field.key];
              const setValue = (v: T[typeof field.key]) => setDraft({ ...draft, [field.key]: v });
              return (
                <div
                  key={field.key}
                  className={cn("flex flex-col gap-1.5", field.full && "col-span-2")}
                >
                  <Label htmlFor={`field-${field.key}`} className="text-xs">
                    {field.label}
                  </Label>
                  <FieldControl
                    id={`field-${field.key}`}
                    field={field}
                    value={value}
                    setValue={setValue}
                    draft={draft}
                    disabled={saving}
                    container={portalContainer}
                  />
                </div>
              );
            })}
          </div>
        )}

        {error && <p className="px-1 text-destructive text-sm">{error}</p>}

        {/* Portal target for nested pickers — see portalContainer above. */}
        <div ref={setPortalContainer} />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FieldControl<T extends { id: string }>({
  id,
  field,
  value,
  setValue,
  draft,
  disabled,
  container,
}: {
  id: string;
  field: EntityField<T>;
  value: T[Extract<keyof T, string>];
  setValue: (v: T[Extract<keyof T, string>]) => void;
  draft: T;
  disabled: boolean;
  container?: HTMLElement | null;
}) {
  const readOnly = disabled || field.readOnly;
  type V = T[Extract<keyof T, string>];

  switch (field.kind) {
    case "textarea":
      return (
        <Textarea
          id={id}
          value={value as string}
          disabled={readOnly}
          rows={3}
          onChange={(e) => setValue(e.currentTarget.value as V)}
        />
      );
    case "number":
      return (
        <Input
          id={id}
          type="number"
          step={field.step}
          // Optional numeric fields can be undefined (e.g. a missing level);
          // display 0 without mutating the underlying value until edited.
          value={(value ?? 0) as number}
          disabled={readOnly}
          onChange={(e) => {
            const n = e.currentTarget.valueAsNumber;
            setValue((Number.isNaN(n) ? 0 : n) as V);
          }}
        />
      );
    case "select":
      return (
        <Select value={value as string} disabled={readOnly} onValueChange={(v) => setValue(v as V)}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "tags":
      return field.options ? (
        <TagsSelect
          value={value as string[]}
          options={field.options}
          disabled={readOnly}
          onChange={(next) => setValue(next as V)}
        />
      ) : (
        <TagsInput
          value={value as string[]}
          disabled={readOnly}
          onChange={(next) => setValue(next as V)}
        />
      );
    case "sprite":
      return (
        <SpritePicker
          value={value as string}
          disabled={readOnly}
          container={container}
          onChange={(name) => setValue(name as V)}
        />
      );
    case "custom":
      return <>{field.render?.({ value, setValue, draft, disabled: !!readOnly })}</>;
    default:
      return (
        <Input
          id={id}
          value={value as string}
          disabled={readOnly}
          onChange={(e) => setValue(e.currentTarget.value as V)}
        />
      );
  }
}

function shallowEqual<T extends object>(a: T, b: T): boolean {
  // Cheap structural compare; values here are primitives or string[]. JSON is
  // sufficient and avoids a dependency for dirty-tracking.
  return JSON.stringify(a) === JSON.stringify(b);
}

export default EntityEditDialog;
