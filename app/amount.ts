/** German grouped amounts take precedence over an ungrouped decimal point, as on iOS. */
export function parseAmount(input: string): number | null {
  const value = input.trim();
  if (!value) return 0;
  const grouped = /^[+-]?[1-9]\d{0,2}(?:\.\d{3})+(?:,\d+)?$/.test(value);
  const digits = grouped ? value.replaceAll(".", "") : value;
  if (!/^[+-]?(?:\d+(?:[,.]\d*)?|[,.]\d+)$/.test(digits)) return null;
  const number = Number(digits.replace(",", "."));
  return Number.isFinite(number) && Math.abs(number) <= 1_000_000_000 ? number : null;
}
