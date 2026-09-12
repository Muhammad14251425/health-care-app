import {
  formatCurrency,
  formatCurrencyCompact,
  currencySymbol,
  parseAmount,
} from '@/utils/currency';

describe('currencySymbol', () => {
  it('uses Rs for the clinic default', () => {
    expect(currencySymbol('PKR')).toBe('Rs');
  });

  it('falls back to the code itself for anything unmapped', () => {
    expect(currencySymbol('XYZ')).toBe('XYZ');
  });

  it('never renders a truncated currency code', () => {
    // InvoiceCard used to derive its badge with `currency.slice(0, 2)`, which
    // showed "IN" for INR and "US" for USD -- a second, wrong source of truth
    // alongside formatCurrency. Every symbol must come from this one table.
    expect(currencySymbol('INR')).toBe('₹');
    expect(currencySymbol('USD')).toBe('$');
    expect(currencySymbol('INR')).not.toBe('IN');
    expect(currencySymbol('USD')).not.toBe('US');
  });

  it('does not confuse PKR with INR', () => {
    // The clinic is Pakistani; rendering ₹ on a PKR invoice is a real defect,
    // not a cosmetic one.
    expect(currencySymbol('PKR')).toBe('Rs');
    expect(currencySymbol('PKR')).not.toBe('₹');
    expect(formatCurrency(3000, 'PKR')).toBe('Rs 3,000');
    expect(formatCurrency(3000, 'PKR')).not.toContain('₹');
  });

  it('defaults to the clinic currency when none is supplied', () => {
    // Every screen passes `invoice.currency ?? 'PKR'`; if that ever becomes
    // undefined the default must still be the clinic's, not a foreign one.
    expect(currencySymbol()).toBe('Rs');
    expect(currencySymbol(undefined)).toBe('Rs');
  });
});

describe('formatCurrency', () => {
  it('groups thousands and drops decimals when whole', () => {
    expect(formatCurrency(3500)).toBe('Rs 3,500');
    expect(formatCurrency(42000)).toBe('Rs 42,000');
  });

  it('keeps two decimals when there is a real fraction', () => {
    expect(formatCurrency(1234.5)).toBe('Rs 1,234.50');
  });

  it('treats null/undefined as zero rather than rendering NaN', () => {
    expect(formatCurrency(null)).toBe('Rs 0');
    expect(formatCurrency(undefined)).toBe('Rs 0');
  });

  it('respects a currency supplied by the backend', () => {
    expect(formatCurrency(50, 'USD')).toBe('$ 50');
  });
});

describe('formatCurrencyCompact', () => {
  it('abbreviates thousands above the 10k threshold', () => {
    expect(formatCurrencyCompact(42000)).toBe('Rs 42K');
    expect(formatCurrencyCompact(16500)).toBe('Rs 16.5K');
  });

  it('abbreviates millions', () => {
    expect(formatCurrencyCompact(1_240_000)).toBe('Rs 1.2M');
  });

  it('leaves smaller amounts fully written out', () => {
    expect(formatCurrencyCompact(3500)).toBe('Rs 3,500');
  });
});

describe('parseAmount', () => {
  it('accepts grouped and prefixed input', () => {
    expect(parseAmount('3,500')).toBe(3500);
    expect(parseAmount('Rs 3500')).toBe(3500);
  });

  it('returns null for input with no digits', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });
});
