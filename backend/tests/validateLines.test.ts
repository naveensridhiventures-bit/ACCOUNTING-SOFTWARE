import { describe, expect, it } from 'vitest';
import { validateLines } from '../src/modules/accounting/posting.service';

const L = (side: 'DR' | 'CR', amount: string | number) => ({ ledgerId: 'x', side, amount });

describe('validateLines', () => {
  it('accepts a balanced voucher and returns the total', () => {
    expect(validateLines([L('DR', '100.50'), L('CR', '100.50')]).total.toFixed(2)).toBe('100.50');
  });
  it('accepts multi-line split vouchers', () => {
    expect(validateLines([L('DR', 100), L('CR', 60), L('CR', 40)]).total.toFixed(2)).toBe('100.00');
  });
  it('is exact with decimals that break floating point (0.1 + 0.2)', () => {
    expect(() => validateLines([L('DR', '0.30'), L('CR', '0.10'), L('CR', '0.20')])).not.toThrow();
  });
  it('rejects unbalanced vouchers with both totals in details', () => {
    try {
      validateLines([L('DR', 100), L('CR', 99.99)]);
      expect.unreachable();
    } catch (e: any) {
      expect(e.code).toBe('VOUCHER_UNBALANCED');
      expect(e.details).toEqual({ debit: '100.00', credit: '99.99' });
    }
  });
  it('rejects fewer than two lines', () => {
    expect(() => validateLines([L('DR', 10)])).toThrow(/at least two/);
  });
  it('rejects zero, negative, NaN and >2 decimal amounts', () => {
    for (const bad of [0, -5, 'abc', '1.234']) {
      expect(() => validateLines([L('DR', bad), L('CR', 10)])).toThrow();
    }
  });
  it('rejects a voucher that is all debits', () => {
    expect(() => validateLines([L('DR', 10), L('DR', 10)])).toThrow(/debits must equal total credits/);
  });
});
