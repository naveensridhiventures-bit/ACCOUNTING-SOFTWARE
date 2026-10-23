import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { prisma } from '../src/lib/prisma';
import { postVoucher, reverseVoucher } from '../src/modules/accounting/posting.service';
import { ledgerStatement, trialBalance } from '../src/modules/accounting/reports.service';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

run('ledger engine (PostgreSQL)', () => {
  let actor: { companyId: string; userId: string };
  let cash: string, sales: string, capital: string;

  beforeAll(async () => {
    const tag = randomUUID().slice(0, 8);
    const company = await prisma.company.create({ data: { name: `Test ${tag}` } });
    const role = await prisma.role.create({ data: { companyId: company.id, name: 'Admin', permissions: ['*'] } });
    const user = await prisma.user.create({ data: { companyId: company.id, roleId: role.id, email: `t-${tag}@x.test`, name: 'T', passwordHash: 'x' } });
    await prisma.financialYear.create({ data: { companyId: company.id, name: '2026-27', startDate: new Date('2026-04-01'), endDate: new Date('2027-03-31') } });
    await prisma.financialYear.create({ data: { companyId: company.id, name: '2025-26', startDate: new Date('2025-04-01'), endDate: new Date('2026-03-31'), isClosed: true } });
    const gA = await prisma.accountGroup.create({ data: { companyId: company.id, name: 'Cash-in-Hand', nature: 'ASSET' } });
    const gI = await prisma.accountGroup.create({ data: { companyId: company.id, name: 'Sales Accounts', nature: 'INCOME' } });
    const gC = await prisma.accountGroup.create({ data: { companyId: company.id, name: 'Capital Account', nature: 'LIABILITY' } });
    // Opening: cash 1000 Dr balanced by capital 1000 Cr
    cash = (await prisma.ledger.create({ data: { companyId: company.id, groupId: gA.id, name: 'Cash', openingBalance: '1000', openingSide: 'DR' } })).id;
    capital = (await prisma.ledger.create({ data: { companyId: company.id, groupId: gC.id, name: 'Capital', openingBalance: '1000', openingSide: 'CR' } })).id;
    sales = (await prisma.ledger.create({ data: { companyId: company.id, groupId: gI.id, name: 'Sales' } })).id;
    actor = { companyId: company.id, userId: user.id };
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const receipt = (amount: string, date = '2026-06-15') =>
    postVoucher(actor, { type: 'RECEIPT', date, narration: 'cash sale', lines: [{ ledgerId: cash, side: 'DR', amount }, { ledgerId: sales, side: 'CR', amount }] });

  it('posts a balanced voucher and assigns a sequential number', async () => {
    const a = await receipt('500.00');
    const b = await receipt('250.25');
    expect(a.number).toBe('RCT-00001');
    expect(b.number).toBe('RCT-00002');
    expect(a.totalAmount.toString()).toBe('500');
  });

  it('rejects unbalanced vouchers and writes nothing', async () => {
    const before = await prisma.voucher.count({ where: { companyId: actor.companyId } });
    await expect(
      postVoucher(actor, { type: 'JOURNAL', date: '2026-06-15', lines: [{ ledgerId: cash, side: 'DR', amount: '10' }, { ledgerId: sales, side: 'CR', amount: '9' }] }),
    ).rejects.toMatchObject({ code: 'VOUCHER_UNBALANCED' });
    expect(await prisma.voucher.count({ where: { companyId: actor.companyId } })).toBe(before);
  });

  it('rejects dates outside any financial year and inside closed years', async () => {
    await expect(receipt('1', '2030-01-01')).rejects.toMatchObject({ code: 'NO_FINANCIAL_YEAR' });
    await expect(receipt('1', '2025-12-01')).rejects.toMatchObject({ code: 'FINANCIAL_YEAR_CLOSED' });
  });

  it('rejects ledgers from another company / unknown ledgers', async () => {
    await expect(
      postVoucher(actor, { type: 'JOURNAL', date: '2026-06-15', lines: [{ ledgerId: randomUUID(), side: 'DR', amount: '5' }, { ledgerId: sales, side: 'CR', amount: '5' }] }),
    ).rejects.toMatchObject({ code: 'INVALID_LEDGER' });
  });

  it('allocates unique numbers under concurrency', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => postVoucher(actor, { type: 'PAYMENT', date: '2026-07-01', lines: [{ ledgerId: sales, side: 'DR', amount: '1' }, { ledgerId: cash, side: 'CR', amount: '1' }] })));
    const numbers = results.map((r) => r.number);
    expect(new Set(numbers).size).toBe(12);
  });

  it('database refuses to edit or delete posted voucher lines', async () => {
    const v = await receipt('10');
    await expect(prisma.$executeRaw`UPDATE "VoucherLine" SET "amount" = 99 WHERE "voucherId" = ${v.id}`).rejects.toThrow(/immutable/i);
    await expect(prisma.$executeRaw`DELETE FROM "VoucherLine" WHERE "voucherId" = ${v.id}`).rejects.toThrow(/immutable/i);
    await expect(prisma.$executeRaw`DELETE FROM "Voucher" WHERE "id" = ${v.id}`).rejects.toThrow(/cannot be deleted/i);
    await expect(prisma.$executeRaw`UPDATE "Voucher" SET "totalAmount" = 99 WHERE "id" = ${v.id}`).rejects.toThrow(/immutable/i);
  });

  it('database itself refuses an unbalanced voucher even if app code is bypassed', async () => {
    const fy = await prisma.financialYear.findFirstOrThrow({ where: { companyId: actor.companyId, name: '2026-27' } });
    await expect(
      prisma.$transaction(async (tx) => {
        const v = await tx.voucher.create({ data: { companyId: actor.companyId, financialYearId: fy.id, type: 'JOURNAL', number: 'RAW-1', date: new Date('2026-06-01'), totalAmount: '10', createdById: actor.userId } });
        await tx.voucherLine.create({ data: { voucherId: v.id, ledgerId: cash, lineNo: 1, side: 'DR', amount: '10' } });
        await tx.voucherLine.create({ data: { voucherId: v.id, ledgerId: sales, lineNo: 2, side: 'CR', amount: '7' } });
        await tx.$executeRaw`SET CONSTRAINTS "VoucherLine_balanced_trg" IMMEDIATE`;
      }),
    ).rejects.toThrow(/unbalanced/i);
  });

  it('survives many integrity rejections without leaking pool connections', async () => {
    const fy = await prisma.financialYear.findFirstOrThrow({ where: { companyId: actor.companyId, name: '2026-27' } });
    for (let i = 0; i < 15; i++) {
      await expect(
        prisma.$transaction(async (tx) => {
          const v = await tx.voucher.create({ data: { companyId: actor.companyId, financialYearId: fy.id, type: 'JOURNAL', number: `LEAK-${i}`, date: new Date('2026-06-01'), totalAmount: '10', createdById: actor.userId } });
          await tx.voucherLine.create({ data: { voucherId: v.id, ledgerId: cash, lineNo: 1, side: 'DR', amount: '10' } });
          await tx.voucherLine.create({ data: { voucherId: v.id, ledgerId: sales, lineNo: 2, side: 'CR', amount: '1' } });
          await tx.$executeRaw`SET CONSTRAINTS "VoucherLine_balanced_trg" IMMEDIATE`;
        }),
      ).rejects.toThrow();
    }
    await expect(receipt('1')).resolves.toBeTruthy(); // pool still healthy
  });

  it('reverses a voucher: original marked REVERSED, effect nets to zero, cannot reverse twice', async () => {
    const before = await ledgerStatement(actor.companyId, sales, '2026-04-01', '2026-12-31');
    const v = await receipt('777.00', '2026-08-01');
    const rev = await reverseVoucher(actor, v.id, { reason: 'wrong party' });
    expect(rev.reversesId).toBe(v.id);
    expect((await prisma.voucher.findUniqueOrThrow({ where: { id: v.id } })).status).toBe('REVERSED');
    const after = await ledgerStatement(actor.companyId, sales, '2026-04-01', '2026-12-31');
    expect(after.closing).toEqual(before.closing);
    await expect(reverseVoucher(actor, v.id, {})).rejects.toMatchObject({ code: 'ALREADY_REVERSED' });
    await expect(reverseVoucher(actor, rev.id, {})).rejects.toMatchObject({ code: 'CANNOT_REVERSE_REVERSAL' });
  });

  it('concurrent reversals of one voucher produce exactly one reversal', async () => {
    const v = await receipt('5.00', '2026-08-02');
    const settled = await Promise.allSettled([reverseVoucher(actor, v.id, {}), reverseVoucher(actor, v.id, {}), reverseVoucher(actor, v.id, {})]);
    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
  });

  it('trial balance balances and equals the sum of ledger statements', async () => {
    const tb = await trialBalance(actor.companyId, undefined, '2026-12-31');
    expect(tb.isBalanced).toBe(true);
    expect(tb.totals.debit).toBe(tb.totals.credit);
    expect(tb.totals.closingDr).toBe(tb.totals.closingCr);
    expect(tb.totals.openingDr).toBe('1000.00'); // cash opening
    expect(tb.totals.openingCr).toBe('1000.00'); // capital opening

    // Reconciliation: each ledger's TB closing equals its statement closing
    for (const row of tb.ledgers) {
      const st = await ledgerStatement(actor.companyId, row.ledgerId, tb.from, tb.to);
      const tbSigned = Number(row.closingDr) - Number(row.closingCr);
      const stSigned = Number(st.closing.amount) * (st.closing.side === 'DR' ? 1 : -1);
      expect(tbSigned).toBeCloseTo(stSigned, 2);
    }
  });

  it('trial balance carries earlier movement into opening when the period starts later', async () => {
    const tb = await trialBalance(actor.companyId, '2026-07-01', '2026-12-31');
    const cashRow = tb.ledgers.find((l) => l.ledger === 'Cash')!;
    expect(Number(cashRow.openingDr)).toBeGreaterThan(1000);
    expect(tb.isBalanced).toBe(true);
  });
});
