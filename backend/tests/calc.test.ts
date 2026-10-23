import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { calcLine, calcTotals } from '../src/modules/sales/documents.service';

const L = (qty: string, rate: string, discountPct = '0', gstRate = '18') => ({ qty: new Decimal(qty), rate: new Decimal(rate), discountPct: new Decimal(discountPct), gstRate: new Decimal(gstRate) });

describe('GST calculation', () => {
  it('splits intra-state tax into equal CGST and SGST', () => {
    const c = calcLine(L('3', '999.99'), false, true);
    expect(c.taxable.toFixed(2)).toBe('2999.97');
    expect(c.cgst.toFixed(2)).toBe(c.sgst.toFixed(2));
    expect(c.igst.toFixed(2)).toBe('0.00');
    expect(c.total.toFixed(2)).toBe(c.taxable.plus(c.cgst).plus(c.sgst).toFixed(2));
  });
  it('charges IGST for inter-state supply', () => {
    const c = calcLine(L('10', '100'), true, true);
    expect(c.igst.toFixed(2)).toBe('180.00');
    expect(c.cgst.toFixed(2)).toBe('0.00');
  });
  it('applies discount before tax', () => {
    const c = calcLine(L('2', '1000', '10'), false, true);
    expect(c.discount.toFixed(2)).toBe('200.00');
    expect(c.taxable.toFixed(2)).toBe('1800.00');
    expect(c.cgst.toFixed(2)).toBe('162.00');
  });
  it('charges no tax when GST is disabled', () => {
    expect(calcLine(L('1', '500'), false, false).total.toFixed(2)).toBe('500.00');
  });
  it('rounds the document total to the nearest rupee and reports the round-off', () => {
    const t = calcTotals([calcLine(L('1', '100.40', '0', '0'), false, true)], true);
    expect(t.total.toFixed(2)).toBe('100.00');
    expect(t.roundOff.toFixed(2)).toBe('-0.40');
    const u = calcTotals([calcLine(L('1', '100.60', '0', '0'), false, true)], true);
    expect(u.total.toFixed(2)).toBe('101.00');
    expect(u.roundOff.toFixed(2)).toBe('0.40');
  });
});
