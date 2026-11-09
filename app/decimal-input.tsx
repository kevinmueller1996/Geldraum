import { useState, type ComponentPropsWithoutRef } from "react";

type DecimalInputProps = Omit<ComponentPropsWithoutRef<"input">, "type" | "inputMode" | "value" | "onChange"> & {
  value: number | undefined;
  onValueChange: (value: number) => void;
};

export default function DecimalInput({ value, onValueChange, onBlur, ...props }: DecimalInputProps) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      {...props}
      type="text"
      inputMode="decimal"
      value={draft ?? (value ? String(value).replace(".", ",") : "")}
      onChange={(event) => {
        const entered = event.target.value.trim();
        if (!/^-?\d*(?:[.,]\d*)?$/.test(entered)) return;

        const parsed = /^-?[.,]?$/.test(entered) ? 0 : Number(entered.replace(",", "."));
        if (!Number.isFinite(parsed)) return;

        setDraft(entered);
        onValueChange(parsed);
      }}
      onBlur={(event) => {
        setDraft(null);
        onBlur?.(event);
      }}
    />
  );
}
