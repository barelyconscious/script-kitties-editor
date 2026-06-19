import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Canonical display text for a numeric value (empty for non-finite). */
function format(n: number): string {
  return Number.isFinite(n) ? String(n) : "";
}

/**
 * A number input that ACCEPTS DECIMALS — the fractional sibling of
 * {@link import("./IntegerInput").IntegerInput}. Reports changes as a number via
 * `onValue`.
 *
 * Why a local text buffer (not a controlled `type="number"`): a controlled number
 * input can't represent in-progress states like `0.`, `1.` or an empty field — it
 * snaps the value back on every keystroke, so the user can never actually type the
 * decimal point. So we hold the raw text locally, push a number upstream only when
 * the buffer parses, and reconcile the buffer to the canonical numeric value on
 * blur (and when `value` changes externally — load, undo/redo — while not editing).
 */
export function DecimalInput({
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
  // the user's in-progress text (e.g. a half-typed "0.").
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
      inputMode="decimal"
      value={text}
      disabled={disabled}
      className={cn("tabular-nums", className)}
      onFocus={(e) => {
        editing.current = true;
        onFocus?.(e);
      }}
      onKeyDown={(e) => {
        // Exponent notation isn't meaningful for a stat; let everything else
        // through (digits, ".", "-", and all editing/navigation keys).
        if (e.key === "e" || e.key === "E") e.preventDefault();
      }}
      onChange={(e) => {
        const raw = e.currentTarget.value;
        setText(raw);
        // Commit only a parseable number; "", "-", "0." stay in the buffer without
        // pushing NaN upstream.
        const n = Number(raw);
        if (raw.trim() !== "" && Number.isFinite(n)) onValue(clamp(n));
      }}
      onBlur={(e) => {
        editing.current = false;
        // Normalize the display to the canonical (clamped) value; an empty or junk
        // buffer falls back to the min (or 0).
        const n = Number(e.currentTarget.value);
        const safe =
          e.currentTarget.value.trim() === "" || !Number.isFinite(n) ? (min ?? 0) : clamp(n);
        onValue(safe);
        setText(format(safe));
        onBlur?.(e);
      }}
      {...rest}
    />
  );
}

export default DecimalInput;
