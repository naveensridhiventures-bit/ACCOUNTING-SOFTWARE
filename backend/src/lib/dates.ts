import { AppError } from './errors';

/** Parse 'YYYY-MM-DD' into a UTC-midnight Date (Postgres DATE columns are timezone-free). */
export function parseDate(s: string): Date {
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new AppError(400, 'INVALID_DATE', `Invalid date: ${s}`);
  }
  return d;
}

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
export const todayIso = () => new Date().toISOString().slice(0, 10);
