import { CurrencyCode } from '../types/marketplace';

export const DEFAULT_CURRENCY_RATES: Record<CurrencyCode, number> = {
  USD: 1,
  TZS: 2650,
  GBP: 0.79,
  EUR: 0.92,
  KES: 129,
};

export function convertUsdToCurrency(
  amountUsd: number,
  currency: CurrencyCode,
  rates: Record<CurrencyCode, number> = DEFAULT_CURRENCY_RATES
): number {
  const rate = rates[currency] ?? 1;
  const converted = amountUsd * rate;
  if (currency === 'TZS' || currency === 'KES') {
    return Math.round(converted / 100) * 100;
  }
  return Math.round(converted * 100) / 100;
}

export function formatPrice(
  amountUsd: number,
  currency: CurrencyCode,
  rates: Record<CurrencyCode, number> = DEFAULT_CURRENCY_RATES
): string {
  const value = convertUsdToCurrency(amountUsd, currency, rates);
  if (currency === 'TZS') {
    return `TZS ${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  }
  if (currency === 'KES') {
    return `KES ${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  }
  const symbols: Record<string, string> = {
    USD: '$',
    GBP: '£',
    EUR: '€',
  };
  return `${symbols[currency] || '$'}${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
