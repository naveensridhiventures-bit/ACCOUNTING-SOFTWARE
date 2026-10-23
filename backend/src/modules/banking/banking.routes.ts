import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { D, ZERO } from '../../lib/money';
import { isoDate, parseDate, todayIso } from '../../lib/dates';
import { actor, requirePermission } from '../../middleware/auth';
import { dateStr, uuid, bool } from '../../lib/http';
import { assertCashBank, cashBankLedgerIds } from '../../lib/systemLedgers';
import { ledgerBalances } from '../../lib/balances';

export const bankingRouter = Router();

bankingRouter.get('/banking/accounts', requirePermission('ledger.read'), async (req, res) => {
  const a = actor(req);
  const ids = await cashBankLedgerIds(prisma, a.companyId);
  const [ledgers, bal] = await Promise.all([
    prisma.ledger.findMany({ where: { id: { in: ids } }, include: { group: { select: { name: true } } }, orderBy: { name: 'asc' } }),
    ledgerBalances(a.companyId, todayIso(), ids),
  ]);
  const rec = await prisma.bankReconciliation.findMany({ where: { companyId: a.companyId, ledgerId: { in: ids } }, include: { voucherLine: { select: { side: true, amount: true } } } });
  res.json({
    items: ledgers.map((l) => {
      const b = bal.get(l.id) ?? ZERO;
      const cleared = rec.filter((r) => r.ledgerId === l.id).reduce((s, r) => s.plus(r.voucherLine.side === 'DR' ? D(r.voucherLine.amount) : D(r.voucherLine.amount).neg()), l.openingSide === 'DR' ? D(l.openingBalance) : D(l.openingBalance).neg());
      return { id: l.id, name: l.name, type: l.group.name === 'Cash-in-Hand' ? 'CASH' : 'BANK', group: l.group.name, isActive: l.isActive, balance: b.toFixed(2), clearedBalance: cleared.toFixed(2), unreconciled: b.minus(cleared).toFixed(2) };
    }),
  });
});

bankingRouter.get('/banking/reconciliation', requirePermission('ledger.read'), async (req, res) => {
  const q = z.object({ ledgerId: uuid, to: dateStr.optional(), show: z.enum(['unreconciled', 'all']).default('unreconciled') }).parse(req.query);
  const a = actor(req);
  await assertCashBank(prisma, a.companyId, q.ledgerId);
  const to = q.to ?? todayIso();
  const ledger = await prisma.ledger.findFirstOrThrow({ where: { id: q.ledgerId, companyId: a.companyId } });
  const lines = await prisma.voucherLine.findMany({
    where: { ledgerId: q.ledgerId, voucher: { companyId: a.companyId, date: { lte: parseDate(to) } }, ...(q.show === 'unreconciled' && { reconciliation: null }) },
    include: { voucher: { select: { id: true, number: true, type: true, date: true, narration: true, reference: true, status: true } }, reconciliation: true },
    orderBy: [{ voucher: { date: 'asc' } }, { voucher: { createdAt: 'asc' } }],
  });
  const opening = ledger.openingSide === 'DR' ? D(ledger.openingBalance) : D(ledger.openingBalance).neg();
  const all = await prisma.voucherLine.findMany({ where: { ledgerId: q.ledgerId, voucher: { companyId: a.companyId, date: { lte: parseDate(to) } } }, select: { side: true, amount: true, reconciliation: { select: { id: true } } } });
  let book = opening, cleared = opening;
  for (const l of all) {
    const s = l.side === 'DR' ? D(l.amount) : D(l.amount).neg();
    book = book.plus(s);
    if (l.reconciliation) cleared = cleared.plus(s);
  }
  res.json({
    ledger: { id: ledger.id, name: ledger.name },
    to,
    bookBalance: book.toFixed(2),
    clearedBalance: cleared.toFixed(2),
    unclearedNet: book.minus(cleared).toFixed(2),
    items: lines.map((l) => ({
      lineId: l.id, voucherId: l.voucher.id, voucherNumber: l.voucher.number, type: l.voucher.type, date: isoDate(l.voucher.date), narration: l.narration ?? l.voucher.narration, reference: l.voucher.reference,
      debit: l.side === 'DR' ? D(l.amount).toFixed(2) : '0.00', credit: l.side === 'CR' ? D(l.amount).toFixed(2) : '0.00',
      reconciled: !!l.reconciliation, bankDate: l.reconciliation ? isoDate(l.reconciliation.bankDate) : null,
    })),
  });
});

bankingRouter.post('/banking/reconciliation', requirePermission('bank.reconcile'), async (req, res) => {
  const b = z.object({ ledgerId: uuid, items: z.array(z.object({ lineId: uuid, bankDate: dateStr })).min(1).max(500) }).parse(req.body);
  const a = actor(req);
  await assertCashBank(prisma, a.companyId, b.ledgerId);
  const lines = await prisma.voucherLine.findMany({ where: { id: { in: b.items.map((i) => i.lineId) }, ledgerId: b.ledgerId, voucher: { companyId: a.companyId } }, select: { id: true } });
  if (lines.length !== new Set(b.items.map((i) => i.lineId)).size) throw new AppError(422, 'INVALID_LINES', 'Some entries do not belong to this account');
  await prisma.$transaction(async (tx) => {
    for (const i of b.items) {
      await tx.bankReconciliation.upsert({
        where: { voucherLineId: i.lineId },
        update: { bankDate: parseDate(i.bankDate), createdById: a.userId },
        create: { companyId: a.companyId, ledgerId: b.ledgerId, voucherLineId: i.lineId, bankDate: parseDate(i.bankDate), createdById: a.userId },
      });
    }
    await tx.auditLog.create({ data: { companyId: a.companyId, userId: a.userId, action: 'BANK_RECONCILED', entity: 'Ledger', entityId: b.ledgerId, data: { count: b.items.length } } });
  });
  res.json({ reconciled: b.items.length });
});

bankingRouter.delete('/banking/reconciliation/:lineId', requirePermission('bank.reconcile'), async (req, res) => {
  const a = actor(req);
  await prisma.bankReconciliation.deleteMany({ where: { companyId: a.companyId, voucherLineId: String(req.params.lineId) } });
  res.status(204).end();
});

