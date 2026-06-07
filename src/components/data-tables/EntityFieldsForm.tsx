import { type ReactNode, useState } from "react";
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
 * Controlled, schema-driven field grid. Renders the `FieldControl` map from a
 * `fields` schema and reports edits up via `onChange` — it owns NO draft, dirty,
 * or save state. Callers (the edit dialog, the Workbench data pane) supply the
 * current `value` and decide what happens on change. `disabled` greys out every
 * field (e.g. while a save is in flight).
 */
export function EntityFieldsForm<T extends { id: string }>({
  fields,
  value,
  onChange,
  disabled = false,
}: {
  fields: EntityField<T>[];
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  // Portal target for nested pickers (sprite picker). Pointing their popovers
  // here — inside this subtree — keeps them within the surrounding scroll-lock
  // subtree so their internal scrolling works.
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);

  return (
    <>
      <div className="grid max-h-[60vh] grid-cols-2 gap-x-4 gap-y-3 overflow-y-auto px-1 py-1">
        {fields.map((field) => {
          const fieldValue = value[field.key];
          const setValue = (v: T[typeof field.key]) => onChange({ ...value, [field.key]: v });
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
                value={fieldValue}
                setValue={setValue}
                draft={value}
                disabled={disabled}
                container={portalContainer}
              />
            </div>
          );
        })}
      </div>

      {/* Portal target for nested pickers — see portalContainer above. */}
      <div ref={setPortalContainer} />
    </>
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
    case "number": {
      // A number field is integer unless it opts into decimals via step "any"
      // (e.g. ability cost). Integer fields reject fractional input outright.
      const isInteger = field.step !== "any";
      return (
        <Input
          id={id}
          type="number"
          inputMode={isInteger ? "numeric" : "decimal"}
          step={field.step ?? (isInteger ? 1 : undefined)}
          // Optional numeric fields can be undefined (e.g. a missing level);
          // display 0 without mutating the underlying value until edited.
          value={(value ?? 0) as number}
          disabled={readOnly}
          onKeyDown={
            isInteger
              ? (e) => {
                  // Block the keys that would introduce a fractional/exponent
                  // value so an integer field can never hold a decimal.
                  if (e.key === "." || e.key === "e" || e.key === "E") e.preventDefault();
                }
              : undefined
          }
          onChange={(e) => {
            const n = e.currentTarget.valueAsNumber;
            // Truncate as a backstop for pasted values that slip past keydown.
            const safe = Number.isNaN(n) ? 0 : isInteger ? Math.trunc(n) : n;
            setValue(safe as V);
          }}
        />
      );
    }
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

export default EntityFieldsForm;
