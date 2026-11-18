import { acceptsAmountEdit, parseAmount } from "./amount";
import { useState, type ComponentPropsWithoutRef } from "react";

type DecimalInputProps = Omit<ComponentPropsWithoutRef<"input">, "type" | "inputMode" | "value" | "onChange"> & {
  value: number | undefined;
  signed?: boolean;
  onValueChange: (value: number) => void;
};

export default function DecimalInput({ value, onValueChange, onBlur, signed = true, ...props }: DecimalInputProps) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      {...props}
      type="text"
      inputMode="decimal"
      value={draft ?? (value ? String(value).replace(".", ",") : "")}
      onChange={(event) => {
        const entered = event.currentTarget.value;
        if (!acceptsAmountEdit(entered, signed)) return;
        const parsed = parseAmount(entered);
        setDraft(entered);
        event.currentTarget.setCustomValidity(parsed === null ? "Bitte gib einen gültigen Betrag ein." : "");
        if (parsed === null) return;
        onValueChange(parsed);
      }}
      onBlur={(event) => {
        if (event.currentTarget.validity.valid) setDraft(null);
        onBlur?.(event);
      }}
    />
  );
}
