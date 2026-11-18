import { acceptsAmountEdit, parseAmount } from "./amount";
import { useState, type ComponentPropsWithoutRef } from "react";

type DecimalInputProps = Omit<ComponentPropsWithoutRef<"input">, "type" | "inputMode" | "value" | "onChange"> & {
  value: number | undefined;
  signed?: boolean;
  fixedMinus?: boolean;
  onValueChange: (value: number) => void;
};

export default function DecimalInput({ value, onValueChange, onBlur, signed = true, fixedMinus = false, ...props }: DecimalInputProps) {
  const [draft, setDraft] = useState<string | null>(null);

  const input = (
    <input
      {...props}
      type="text"
      inputMode="decimal"
      value={draft ?? (value ? String(fixedMinus ? Math.abs(value) : value).replace(".", ",") : "")}
      onChange={(event) => {
        const entered = event.currentTarget.value;
        if ((fixedMinus && entered.startsWith("+")) || !acceptsAmountEdit(entered, signed && !fixedMinus)) return;
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
  if (!fixedMinus) return input;
  const sign = value !== undefined && value < 0 ? "+" : "−";
  return <span className="card-balance-input"><span aria-hidden="true">{sign}</span>{input}</span>;
}
