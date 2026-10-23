import Decimal from 'decimal.js';

export type Numeric = Decimal.Value | { toString(): string } | null | undefined;

/** Convert Prisma Decimals / strings / numbers to decimal.js (null -> 0). */
export const D = (v: Numeric): Decimal => new Decimal(v == null ? 0 : typeof v === 'object' && !(v instanceof Decimal) ? v.toString() : (v as Decimal.Value));
export const r2 = (v: Decimal): Decimal => v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
export const r3 = (v: Decimal): Decimal => v.toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
export const f2 = (v: Numeric): string => D(v).toFixed(2);
export const ZERO = new Decimal(0);
