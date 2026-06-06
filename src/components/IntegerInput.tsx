import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A number input locked to whole numbers: fractional/exponent keys are rejected
 * outright, and any value that slips through (e.g. a paste) is truncated. Reports
 * changes as a number via `onValue`. Mirrors the integer handling in the entity
 * edit dialog so every whole-number field behaves identically.
 */
export function IntegerInput({
  value,
  onValue,
  disabled,
  className,
  min,
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
  return (
    <Input
      type="number"
      inputMode="numeric"
      step={1}
      min={min}
      value={value}
      disabled={disabled}
      className={cn("tabular-nums", className)}
      onKeyDown={(e) => {
        if (e.key === "." || e.key === "e" || e.key === "E") e.preventDefault();
      }}
      onChange={(e) => {
        const n = e.currentTarget.valueAsNumber;
        let safe = Number.isNaN(n) ? 0 : Math.trunc(n);
        if (min != null && safe < min) safe = min;
        onValue(safe);
      }}
      {...rest}
    />
  );
}

export default IntegerInput;
