import { num } from './format';

/** Mirrors the API's GST maths (paise-accurate) so the on-screen total always matches what gets posted. */
const r2 = (x: number) => Math.round((x + Number.EPSILON * Math.sign(x)) * 100) / 100;

export interface LineIn { qty: number | string; rate: number | string; discountPct: number | string; gstRate: number | string }
export function calcLine(l: LineIn, interState: boolean, gstEnabled: boolean) {
  const gross = r2(num(l.qty) * num(l.rate));
  const discount = r2((gross * num(l.discountPct)) / 100);
  const taxable = r2(gross - discount);
  const rate = gstEnabled ? num(l.gstRate) : 0;
  let cgst = 0, sgst = 0, igst = 0;
  if (interState) igst = r2((taxable * rate) / 100);
  else { cgst = r2((taxable * rate) / 200); sgst = cgst; }
  return { gross, discount, taxable, cgst, sgst, igst, total: r2(taxable + cgst + sgst + igst) };
}
export function calcTotals(lines: ReturnType<typeof calcLine>[], roundToRupee: boolean) {
  const sum = (f: (l: ReturnType<typeof calcLine>) => number) => r2(lines.reduce((a, l) => a + f(l), 0));
  const raw = sum((l) => l.total);
  const total = roundToRupee ? Math.round(raw) : raw;
  return { subtotal: sum((l) => l.gross), discount: sum((l) => l.discount), taxable: sum((l) => l.taxable), cgst: sum((l) => l.cgst), sgst: sum((l) => l.sgst), igst: sum((l) => l.igst), roundOff: r2(total - raw), total };
}
