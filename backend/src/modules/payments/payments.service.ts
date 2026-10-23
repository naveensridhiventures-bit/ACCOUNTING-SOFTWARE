import { PaymentDirection, PaymentMode } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError, notFound } from '../../lib/errors';
import { D, f2, ZERO } from '../../lib/money';
import { parseDate } from '../../lib/dates';
import { Actor, LineInput, postVoucherTx, reverseVoucherTx } from '../accounting/posting.service';
import { assertCashBank, systemLedgers } from '../../lib/systemLedgers';
import { allocateTx } from '../sales/documents.service';
import { calcLine } from '../sales/documents.service';
import Decimal from 'decimal.js';

export interface PaymentInput {
  direction: PaymentDirection;
  partyId: string;
  accountId: string;
  date: string;
  amount: string | number;
  mode: PaymentMode;
  reference?: string | undefined;
  notes?: string | undefined;
  allocations?: { documentId: string; amount: string | number }[] | undefined;
}

/** Record money received from a customer / paid to a supplier, optionally settling invoices or bills. */
export function createPayment(actor: Actor, input: PaymentInput) {
  return prisma.$transaction(async (tx) => {
    const amount = D(input.amount);
    if (amount.lte(0) || amount.decimalPlaces() > 2) throw new AppError(422, 'INVALID_AMOUNT', 'Amount must be positive with at most 2 decimals');
    const party = await tx.party.findFirst({ where: { id: input.partyId, companyId: actor.companyId } });
    if (!party) throw new AppError(422, 'INVALID_PARTY', 'Party not found');
    if (input.direction === 'RECEIVED' && party.type !== 'CUSTOMER') throw new AppError(422, 'WRONG_PARTY_TYPE', 'Receipts are recorded against customers');
    if (input.direction === 'PAID' && party.type !== 'SUPPLIER') throw new AppError(422, 'WRONG_PARTY_TYPE', 'Payments are recorded against suppliers');
    await assertCashBank(tx, actor.companyId, input.accountId);
    const allocTotal = (input.allocations ?? []).reduce((a, i) => a.plus(D(i.amount)), ZERO);
    if (allocTotal.gt(amount)) throw new AppError(422, 'OVER_ALLOCATED', 'Allocated amount exceeds the payment amount');

    const received = input.direction === 'RECEIVED';
    const voucher = await postVoucherTx(tx, actor, {
      type: received ? 'RECEIPT' : 'PAYMENT',
      date: input.date,
      reference: input.reference,
      source: 'PAYMENT',
      narration: `${received ? 'Receipt from' : 'Payment to'} ${party.name}${input.reference ? ` (${input.reference})` : ''}`,
      lines: [
        { ledgerId: input.accountId, side: received ? 'DR' : 'CR', amount: amount.toFixed(2) },
        { ledgerId: party.ledgerId, side: received ? 'CR' : 'DR', amount: amount.toFixed(2) },
      ],
    });
    const payment = await tx.payment.create({
      data: {
        companyId: actor.companyId,
        voucherId: voucher.id,
        partyId: party.id,
        direction: input.direction,
        mode: input.mode,
        amount: amount.toFixed(2),
        date: parseDate(input.date),
        reference: input.reference?.trim() || null,
        accountId: input.accountId,
        notes: input.notes?.trim() || null,
        createdById: actor.userId,
      },
    });
    if (input.allocations?.length) await allocateTx(tx, actor, { paymentId: payment.id }, input.allocations);
    await tx.auditLog.create({
      data: { companyId: actor.companyId, userId: actor.userId, action: 'PAYMENT_RECORDED', entity: 'Payment', entityId: payment.id, data: { number: voucher.number, party: party.name, amount: amount.toFixed(2), direction: input.direction } },
    });
    return { ...payment, voucherNumber: voucher.number };
  }, { timeout: 30000 });
}

export function allocatePayment(actor: Actor, paymentId: string, items: { documentId: string; amount: string | number }[]) {
  return prisma.$transaction(async (tx) => {
    await allocateTx(tx, actor, { paymentId }, items);
    await tx.auditLog.create({ data: { companyId: actor.companyId, userId: actor.userId, action: 'PAYMENT_ALLOCATED', entity: 'Payment', entityId: paymentId, data: { items } as object } });
  });
}

export function removeAllocation(actor: Actor, allocationId: string) {
  return prisma.$transaction(async (tx) => {
    const a = await tx.allocation.findFirst({ where: { id: allocationId, companyId: actor.companyId } });
    if (!a) throw notFound('Allocation');
    await tx.allocation.delete({ where: { id: a.id } });
    await tx.auditLog.create({ data: { companyId: actor.companyId, userId: actor.userId, action: 'ALLOCATION_REMOVED', entity: 'Allocation', entityId: a.id, data: { documentId: a.documentId, amount: f2(a.amount) } } });
  });
}

export function cancelPayment(actor: Actor, paymentId: string, reason?: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${paymentId} AND "companyId" = ${actor.companyId} FOR UPDATE`;
    const p = await tx.payment.findFirst({ where: { id: paymentId, companyId: actor.companyId }, include: { voucher: { include: { lines: { include: { reconciliation: true } } } } } });
    if (!p) throw notFound('Payment');
    if (p.status === 'CANCELLED') throw new AppError(409, 'ALREADY_CANCELLED', 'Payment is already cancelled');
    if (p.voucher.lines.some((l) => l.reconciliation)) throw new AppError(409, 'RECONCILED', 'This payment is already reconciled with the bank statement. Un-reconcile it first.');
    await tx.allocation.deleteMany({ where: { paymentId } }); // settlement is undone; the books are corrected via the reversal voucher
    await reverseVoucherTx(tx, actor, p.voucherId, { reason: reason ?? 'Payment cancelled' });
    await tx.payment.update({ where: { id: paymentId }, data: { status: 'CANCELLED' } });
    await tx.auditLog.create({ data: { companyId: actor.companyId, userId: actor.userId, action: 'PAYMENT_CANCELLED', entity: 'Payment', entityId: paymentId, data: { reason: reason ?? null } } });
  }, { timeout: 30000 });
}

// -------------------------------------------------------------------- expenses
export interface ExpenseInput {
  date: string;
  expenseLedgerId: string;
  paidFromId: string;
  amount: string | number; // taxable value
  gstRate?: string | number | undefined;
  interState?: boolean | undefined;
  reference?: string | undefined;
  payee?: string | undefined;
  notes?: string | undefined;
}

/** Quick expense: DR expense (+ input GST) / CR cash or bank, posted as a PAYMENT voucher. */
export function createExpense(actor: Actor, input: ExpenseInput) {
  return prisma.$transaction(async (tx) => {
    const company = await tx.company.findUniqueOrThrow({ where: { id: actor.companyId } });
    const exp = await tx.ledger.findFirst({ where: { id: input.expenseLedgerId, companyId: actor.companyId, isActive: true }, include: { group: true } });
    if (!exp || exp.group.nature !== 'EXPENSE') throw new AppError(422, 'INVALID_LEDGER', 'Choose an expense account');
    await assertCashBank(tx, actor.companyId, input.paidFromId);
    const base = D(input.amount);
    if (base.lte(0) || base.decimalPlaces() > 2) throw new AppError(422, 'INVALID_AMOUNT', 'Amount must be positive with at most 2 decimals');
    const interState = input.interState ?? false;
    const c = calcLine({ qty: new Decimal(1), rate: base, discountPct: ZERO, gstRate: D(input.gstRate) }, interState, company.gstEnabled);
    const sys = await systemLedgers(tx, actor.companyId, ['INPUT_CGST', 'INPUT_SGST', 'INPUT_IGST']);
    const lines: LineInput[] = [{ ledgerId: exp.id, side: 'DR', amount: c.taxable.toFixed(2) }];
    if (c.cgst.gt(0)) lines.push({ ledgerId: sys.INPUT_CGST, side: 'DR', amount: c.cgst.toFixed(2) });
    if (c.sgst.gt(0)) lines.push({ ledgerId: sys.INPUT_SGST, side: 'DR', amount: c.sgst.toFixed(2) });
    if (c.igst.gt(0)) lines.push({ ledgerId: sys.INPUT_IGST, side: 'DR', amount: c.igst.toFixed(2) });
    lines.push({ ledgerId: input.paidFromId, side: 'CR', amount: c.total.toFixed(2) });
    const voucher = await postVoucherTx(tx, actor, {
      type: 'PAYMENT',
      date: input.date,
      reference: input.reference,
      source: 'EXPENSE',
      narration: `${exp.name}${input.payee ? ` - ${input.payee}` : ''}${input.notes ? `: ${input.notes}` : ''}`.slice(0, 500),
      lines,
    });
    await tx.auditLog.create({ data: { companyId: actor.companyId, userId: actor.userId, action: 'EXPENSE_RECORDED', entity: 'Voucher', entityId: voucher.id, data: { number: voucher.number, ledger: exp.name, total: c.total.toFixed(2) } } });
    return voucher;
  });
}

// ------------------------------------------------------------------- transfers
export function createTransfer(actor: Actor, input: { date: string; fromId: string; toId: string; amount: string | number; reference?: string | undefined; notes?: string | undefined }) {
  return prisma.$transaction(async (tx) => {
    if (input.fromId === input.toId) throw new AppError(422, 'SAME_ACCOUNT', 'Choose two different accounts');
    await assertCashBank(tx, actor.companyId, input.fromId);
    await assertCashBank(tx, actor.companyId, input.toId);
    const amt = D(input.amount);
    if (amt.lte(0) || amt.decimalPlaces() > 2) throw new AppError(422, 'INVALID_AMOUNT', 'Amount must be positive with at most 2 decimals');
    const v = await postVoucherTx(tx, actor, {
      type: 'CONTRA',
      date: input.date,
      reference: input.reference,
      source: 'MANUAL',
      narration: input.notes ?? 'Fund transfer',
      lines: [
        { ledgerId: input.toId, side: 'DR', amount: amt.toFixed(2) },
        { ledgerId: input.fromId, side: 'CR', amount: amt.toFixed(2) },
      ],
    });
    return v;
  });
}
