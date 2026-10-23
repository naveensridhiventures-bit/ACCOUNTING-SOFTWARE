import { z } from 'zod';

export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const money = z.union([z.string().regex(/^\d+(\.\d{1,2})?$/, 'Invalid amount'), z.number().nonnegative()]);
export const positiveMoney = z.union([z.string().regex(/^\d+(\.\d{1,2})?$/, 'Invalid amount'), z.number().positive()]);
export const uuid = z.string().uuid();
export const optStr = (max = 300) => z.string().trim().max(max).optional().transform((v) => (v === '' ? undefined : v));
export const bool = z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]);

export const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
};
export const rangeQuery = { from: dateStr.optional(), to: dateStr.optional() };

export const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/, 'Invalid GSTIN');
export const pan = z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'Invalid PAN');
