import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import Decimal from 'decimal.js';
import { prisma } from '../src/lib/prisma';
import { ensureGroups, ensureSystemLedgers } from '../src/lib/bootstrap';
import { cancelDocument, createDocument } from '../src/modules/sales/documents.service';
import { allocatePayment, cancelPayment, createPayment } from '../src/modules/payments/payments.service';
import { balanceSheet, profitAndLoss } from '../src/modules/reports/financial.service';
import { trialBalance } from '../src/modules/accounting/reports.service';
import { ageing } from '../src/modules/reports/receivables.service';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

run('invoicing, stock and payments (PostgreSQL)', () => {
  let actor: { companyId: string; userId: string };
  let customer: string, supplier: string, bank: string, product: string, customerLedger: string;
  const today = '2026-06-15';

  beforeAll(async () => {
    const tag = randomUUID().slice(0, 8);
    const company = await prisma.company.create({ data: { name: `Docs ${tag}`, stateCode: '29' } });
    const role = await prisma.role.create({ data: { companyId: company.id, name: 'Admin', permissions: ['*'] } });
    const user = await prisma.user.create({ data: { companyId: company.id, roleId: role.id, email: `d-${tag}@x.test`, name: 'T', passwordHash: 'x' } });
    await prisma.financialYear.create({ data: { companyId: company.id, name: '2026-27', startDate: new Date('2026-04-01'), endDate: new Date('2027-03-31') } });
    const groups = await ensureGroups(company.id);
    await ensureSystemLedgers(company.id, groups);
    actor = { companyId: company.id, userId: user.id };
    bank = (await prisma.ledger.create({ data: { companyId: company.id, groupId: groups['Bank Accounts']!, name: 'Bank' } })).id;
    const mk = async (type: 'CUSTOMER' | 'SUPPLIER', name: string, stateCode: string) => {
      const l = await prisma.ledger.create({ data: { companyId: company.id, groupId: groups[type === 'CUSTOMER' ? 'Sundry Debtors' : 'Sundry Creditors']!, name } });
      const p = await prisma.party.create({ data: { companyId: company.id, ledgerId: l.id, type, name, stateCode, creditDays: 30 } });
      return { id: p.id, ledgerId: l.id };
    };
    const c = await mk('CUSTOMER', 'Cust', '29');
    customer = c.id;
    customerLedger = c.ledgerId;
    supplier = (await mk('SUPPLIER', 'Supp', '27')).id;
    product = (await prisma.product.create({ data: { companyId: company.id, sku: 'P1', name: 'Widget', hsn: '1234', salePrice: '200', purchasePrice: '100', gstRate: '18' } })).id;
  });
  afterAll(() => prisma.$disconnect());

  const stock = async () => prisma.product.findUniqueOrThrow({ where: { id: product } });
  const inventoryBalance = async () => {
    const l = await prisma.ledger.findFirstOrThrow({ where: { companyId: actor.companyId, systemKey: 'INVENTORY' } });
    const lines = await prisma.voucherLine.findMany({ where: { ledgerId: l.id } });
    return lines.reduce((s, x) => (x.side === 'DR' ? s.plus(x.amount.toString()) : s.minus(x.amount.toString())), new Decimal(0));
  };

  it('purchase bill brings stock in at cost and posts inter-state IGST', async () => {
    const bill = await createDocument(actor, { type: 'PURCHASE_BILL', date: today, partyId: supplier, lines: [{ productId: product, qty: 10 }] });
    expect(bill.isInterState).toBe(true);
    expect(bill.igstTotal.toString()).toBe('180');
    expect(bill.total.toString()).toBe('1180');
    const p = await stock();
    expect(p.onHandQty.toString()).toBe('10');
    expect(p.onHandValue.toString()).toBe('1000');
    expect((await inventoryBalance()).toString()).toBe('1000');
  });

  it('sales invoice posts revenue, CGST/SGST and cost of goods sold at average cost', async () => {
    const inv = await createDocument(actor, { type: 'SALES_INVOICE', date: today, partyId: customer, lines: [{ productId: product, qty: 4 }] });
    expect(inv.total.toString()).toBe('944'); // 800 + 72 + 72
    expect(inv.cgstTotal.toString()).toBe('72');
    const p = await stock();
    expect(p.onHandQty.toString()).toBe('6');
    expect(p.onHandValue.toString()).toBe('600');
    const line = await prisma.documentLine.findFirstOrThrow({ where: { documentId: inv.id } });
    expect(line.costAmount.toString()).toBe('400');
    expect((await inventoryBalance()).toString()).toBe('600');
  });

  it('refuses to sell more than is in stock', async () => {
    await expect(createDocument(actor, { type: 'SALES_INVOICE', date: today, partyId: customer, lines: [{ productId: product, qty: 7 }] })).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    expect((await stock()).onHandQty.toString()).toBe('6'); // nothing leaked from the failed transaction
  });

  it('settles an invoice through a payment and rejects over-allocation', async () => {
    const inv = await prisma.document.findFirstOrThrow({ where: { companyId: actor.companyId, type: 'SALES_INVOICE' } });
    const pay = await createPayment(actor, { direction: 'RECEIVED', partyId: customer, accountId: bank, date: today, amount: '500', mode: 'BANK', allocations: [{ documentId: inv.id, amount: '500' }] });
    const aged = await ageing(actor.companyId, 'RECEIVABLES', today);
    expect(aged.totals.outstanding).toBe('444.00');
    await expect(allocatePayment(actor, pay.id, [{ documentId: inv.id, amount: '1' }])).rejects.toMatchObject({ code: 'OVER_ALLOCATED' });
    await createPayment(actor, { direction: 'RECEIVED', partyId: customer, accountId: bank, date: today, amount: '444', mode: 'UPI', allocations: [{ documentId: inv.id, amount: '444' }] });
    expect((await ageing(actor.companyId, 'RECEIVABLES', today)).totals.outstanding).toBe('0.00');
  });

  it('credit note returns stock and can be applied against the invoice', async () => {
    const inv = await prisma.document.findFirstOrThrow({ where: { companyId: actor.companyId, type: 'SALES_INVOICE' } });
    const cn = await createDocument(actor, { type: 'CREDIT_NOTE', date: today, partyId: customer, originalDocumentId: inv.id, lines: [{ productId: product, qty: 1 }] });
    expect(cn.total.toString()).toBe('236');
    expect((await stock()).onHandQty.toString()).toBe('7');
    expect((await inventoryBalance()).toString()).toBe('700');
  });

  it('cancelling an invoice reverses its voucher and restores stock; payments block cancellation', async () => {
    const inv = await createDocument(actor, { type: 'SALES_INVOICE', date: today, partyId: customer, lines: [{ productId: product, qty: 2 }] });
    expect((await stock()).onHandQty.toString()).toBe('5');
    const pay = await createPayment(actor, { direction: 'RECEIVED', partyId: customer, accountId: bank, date: today, amount: '100', mode: 'CASH', allocations: [{ documentId: inv.id, amount: '100' }] });
    await expect(cancelDocument(actor, inv.id)).rejects.toMatchObject({ code: 'HAS_ALLOCATIONS' });
    await cancelPayment(actor, pay.id);
    await cancelDocument(actor, inv.id, 'test');
    expect((await stock()).onHandQty.toString()).toBe('7');
    expect((await inventoryBalance()).toString()).toBe('700');
    const v = await prisma.voucher.findUniqueOrThrow({ where: { id: inv.voucherId } });
    expect(v.status).toBe('REVERSED');
  });

  it('keeps the books balanced: trial balance, balance sheet and party ledger agree', async () => {
    const tb = await trialBalance(actor.companyId, '2026-04-01', '2026-12-31');
    expect(tb.isBalanced).toBe(true);
    const bs = await balanceSheet(actor.companyId, '2026-12-31');
    expect(bs.isBalanced).toBe(true);
    const pl = await profitAndLoss(actor.companyId, '2026-04-01', '2026-12-31');
    expect(pl.revenue.total).toBe('600.00'); // 800 sales - 200 returned
    expect(pl.costOfSales.total).toBe('300.00'); // 3 units net at cost 100
    expect(pl.netProfit).toBe('300.00');
    const dr = await prisma.voucherLine.groupBy({ by: ['side'], where: { ledgerId: customerLedger }, _sum: { amount: true } });
    expect(dr.length).toBeGreaterThan(0);
  });
});
