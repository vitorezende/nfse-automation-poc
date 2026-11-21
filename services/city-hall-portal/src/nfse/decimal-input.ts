import { Prisma } from '../generated/prisma/client.js';

/**
 * Parses a decimal typed in a form, accepting Brazilian ("1.500,00") and plain ("1500.00") notation.
 * Returns null when the text isn't a number.
 */
export function parseDecimalInput(text: string | undefined): Prisma.Decimal | null {
  if (!text) return null;
  let normalized = text.trim().replace(/\s/g, '');
  // A comma is always the decimal separator; dots in groups of three digits ("1.500") are thousands separators.
  if (normalized.includes(',') || /^\d{1,3}(\.\d{3})+$/.test(normalized)) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  }
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  return new Prisma.Decimal(normalized);
}

export function formatBrl(value: Prisma.Decimal): string {
  return value.toNumber().toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatPercent(rate: Prisma.Decimal): string {
  return `${rate.mul(100).toNumber().toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}
