import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Canonical display text for a whole-number value (empty for non-finite). */
function format(n: number): string {
  return Number.isFinite(n) ? String(Math.trunc(n)) : "";
}

/**
 * A number input locked to whole numbers: fractional/exponent keys are rejected
 * outright, and any value that slips through (e.g. a paste) is truncated. Reports
 * changes as a number via `onValue`. The integer sibling of
 * {@link import("./DecimalInput").DecimalInput}.
 *
 * Why a local text buffer (not a controlled `type="number"`): a controlled number
 * input can't represent an empty field — it snaps `NaN` back to `0` on every
 * keystroke, so clearing the field and typing `23` yields `023`. So we hold the raw
 * text locally, push a (truncated) number upstream only when the buffer parses, and
 * reconcile the buffer to the canonical numeric value on blur (and when `value`
 * changes externally — load, undo/redo — while not editing).
 */
export function IntegerInput({
  value,
  onValue,
  disabled,
  className,
  min,
  onFocus,
  onBlur,
  ...rest
}: {
  value: number;
  onValue: (n: number) => void;
  disabled?: boolean;
  className?: string;
  min?: number;
} & Omit<
  React.ComponentProps<typeof Input>,
  "value" | "onChange" | "type" | "disabled" | "className"
>) {
  const [text, setText] = useState(() => format(value));
  // True while the field is focused, so an external `value` sync never clobbers
  // the user's in-progress text (e.g. a transiently-empty field).
  const editing = useRef(false);

  // Pull external value changes (load, undo/redo, another field writing the draft)
  // into the buffer — but only when the user isn't mid-edit.
  useEffect(() => {
    if (editing.current) return;
    if (Number(text) !== value) setText(format(value));
  }, [value, text]);

  const clamp = (n: number) => (min != null && n < min ? min : n);

  return (
    <Input
      type="text"
      inputMode="numeric"
      value={text}
      disabled={disabled}
      className={cn("tabular-nums", className)}
      onFocus={(e) => {
        editing.current = true;
        onFocus?.(e);
      }}
      onKeyDown={(e) => {
        // Fractional/exponent notation isn't valid for a whole-number field; let
        // everything else through (digits, "-", and all editing/navigation keys).
        if (e.key === "." || e.key === "e" || e.key === "E") e.preventDefault();
      }}
      onChange={(e) => {
        const raw = e.currentTarget.value;
        setText(raw);
        // Commit only a parseable number; "", "-" stay in the buffer without
        // pushing NaN upstream. Truncate so a pasted "1.9" commits as 1.
        const n = Number(raw);
        if (raw.trim() !== "" && Number.isFinite(n)) onValue(clamp(Math.trunc(n)));
      }}
      onBlur={(e) => {
        editing.current = false;
        // Normalize the display to the canonical (clamped, truncated) value; an
        // empty or junk buffer falls back to the min (or 0).
        const n = Number(e.currentTarget.value);
        const safe =
          e.currentTarget.value.trim() === "" || !Number.isFinite(n)
            ? (min ?? 0)
            : clamp(Math.trunc(n));
        onValue(safe);
        setText(format(safe));
        onBlur?.(e);
      }}
      {...rest}
    />
  );
}

export default IntegerInput;
