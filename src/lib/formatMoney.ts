export function formatMoney(
  amount: number,
  currency: string,
  locale: string,
): string {
  if (!Number.isFinite(amount)) {
    throw new RangeError("Money amount must be finite.");
  }
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}
