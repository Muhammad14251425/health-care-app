/**
 * Currency formatting. One formatter, used everywhere.
 *
 * The clinic company is configured in PKR, and ERPNext returns a `currency` on
 * each invoice -- prefer that over the default so a differently-configured site
 * still renders correctly.
 */

const SYMBOLS: Record<string, string> = {
  PKR: 'Rs',
  USD: '$',
  EUR: '€',
  GBP: '£',
  AED: 'AED',
  INR: '₹',
};

export const DEFAULT_CURRENCY = 'PKR';

export function currencySymbol(currency = DEFAULT_CURRENCY): string {
  return SYMBOLS[currency] ?? currency;
}

/**
 * "Rs 3,500" -- grouped, no decimals when whole.
 *
 * Clinic amounts are read at a glance in lists; trailing ".00" on every row is
 * noise. Fractional amounts still show two decimals so nothing is hidden.
 */
export function formatCurrency(
  amount: number | null | undefined,
  currency = DEFAULT_CURRENCY,
): string {
  const value = Number(amount ?? 0);
  if (!Number.isFinite(value)) return `${currencySymbol(currency)} 0`;

  const hasFraction = Math.abs(value % 1) > 0.004;
  const formatted = value.toLocaleString('en-US', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return `${currencySymbol(currency)} ${formatted}`;
}

/** Compact form for dashboard tiles: "Rs 42.5K". */
export function formatCurrencyCompact(
  amount: number | null | undefined,
  currency = DEFAULT_CURRENCY,
): string {
  const value = Number(amount ?? 0);
  if (!Number.isFinite(value)) return `${currencySymbol(currency)} 0`;
  const abs = Math.abs(value);

  if (abs >= 1_000_000) {
    return `${currencySymbol(currency)} ${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (abs >= 10_000) {
    return `${currencySymbol(currency)} ${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  return formatCurrency(value, currency);
}

/** Parse user input ("3,500" / "Rs 3500") into a number, or null if invalid. */
export function parseAmount(input: string): number | null {
  const cleaned = (input ?? '').replace(/[^\d.]/g, '');
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}
