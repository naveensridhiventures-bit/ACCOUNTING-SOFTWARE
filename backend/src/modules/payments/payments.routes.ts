import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { notFound } from '../../lib/errors';
import { D, f2, ZERO } from '../../lib/money';
import { isoDate, parseDate } from '../../lib/dates';
import { actor, authenticate, requirePermission } from '../../middleware/auth';
import { dateStr, optStr, pageQuery, positiveMoney, uuid } from '../../lib/http';
import { allocatePayment, cancelPayment, createExpense, createPayment, createTransfer, removeAllocation } from './payments.service';

export const paymentsRouter = Router();

const allocations = z.array(z.object({ documentId: uuid, amount: positiveMoney })).max(200);
const paymentBody = z.object({
  direction: z.enum(['RECEIVED', 'PAID']),
  partyId: uuid,
  accountId: uuid,
  date: dateStr,
  amount: positiveMoney,
  mode: z.enum(['CASH', 'BANK', 'UPI', 'CARD', 'CHEQUE', 'OTHER']).default('BANK'),
  reference: optStr(100),
  notes: optStr(500),
  allocations: allocations.optional(),
});

paymentsRouter.post('/payments', requirePermission('payment.write'), async (req, res) => {
  res.status(201).json(await createPayment(actor(req), paymentBody.parse(req.body)));
});

paymentsRouter.get('/payments', requirePermission('payment.read'), async (req, res) => {
  const q = z
    .object({ direction: z.enum(['RECEIVED', 'PAID']).optional(), partyId: uuid.optional(), status: z.enum(['ACTIVE', 'CANCELLED']).optional(), q: z.string().trim().optional(), from: dateStr.optional(), to: dateStr.optional(), ...pageQuery })
    .parse(req.query);
  const a = actor(req);
  const where: Prisma.PaymentWhereInput = {
    companyId: a.companyId,
    ...(q.direction && { direction: q.direction }),
    ...(q.partyId && { partyId: q.partyId }),
    ...(q.status && { status: q.status }),
    ...((q.from || q.to) && { date: { ...(q.from && { gte: parseDate(q.from) }), ...(q.to && { lte: parseDate(q.to) }) } }),
    ...(q.q && { OR: [{ reference: { contains: q.q, mode: 'insensitive' } }, { party: { name: { contains: q.q, mode: 'insensitive' } } }, { voucher: { number: { contains: q.q, mode: 'insensitive' } } }] }),
  };
  const [rows, total, agg] = await Promise.all([
    prisma.payment.findMany({ where, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { party: { select: { id: true, name: true } }, voucher: { select: { number: true } } } }),
    prisma.payment.count({ where }),
    prisma.payment.aggregate({ where: { ...where, status: 'ACTIVE' }, _sum: { amount: true } }),
  ]);
  const used = await prisma.allocation.groupBy({ by: ['paymentId'], where: { paymentId: { in: rows.map((r) => r.id) } }, _sum: { amount: true } });
  const usedMap = new Map(used.map((u) => [u.paymentId, D(u._sum.amount)]));
  const accounts = new Map((await prisma.ledger.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.accountId))] } }, select: { id: true, name: true } })).map((l) => [l.id, l.name]));
  res.json({
    items: rows.map((p) => ({
      id: p.id, number: p.voucher.number, date: isoDate(p.date), direction: p.direction, mode: p.mode, party: p.party, amount: f2(p.amount),
      allocated: (usedMap.get(p.id) ?? ZERO).toFixed(2), unallocated: D(p.amount).minus(usedMap.get(p.id) ?? ZERO).toFixed(2),
      reference: p.reference, account: accounts.get(p.accountId) ?? '', status: p.status,
    })),
    total, page: q.page, pageSize: q.pageSize, totals: { amount: f2(agg._sum.amount) },
  });
});

paymentsRouter.get('/payments/:id', requirePermission('payment.read'), async (req, res) => {
  const a = actor(req);
  const p = await prisma.payment.findFirst({
    where: { id: String(req.params.id), companyId: a.companyId },
    include: { party: true, voucher: { select: { id: true, number: true } }, allocations: { include: { document: { select: { id: true, number: true, type: true, total: true, date: true } } } } },
  });
  if (!p) throw notFound('Payment');
  const account = await prisma.ledger.findUnique({ where: { id: p.accountId }, select: { id: true, name: true } });
  const allocated = p.allocations.reduce((s, x) => s.plus(D(x.amount)), ZERO);
  res.json({ ...p, account, allocated: allocated.toFixed(2), unallocated: D(p.amount).minus(allocated).toFixed(2) });
});

paymentsRouter.post('/payments/:id/allocate', requirePermission('payment.write'), async (req, res) => {
  const { items } = z.object({ items: allocations.min(1) }).parse(req.body);
  await allocatePayment(actor(req), String(req.params.id), items);
  res.json({ ok: true });
});

paymentsRouter.post('/payments/:id/cancel', requirePermission('payment.write'), async (req, res) => {
  const { reason } = z.object({ reason: optStr(300) }).parse(req.body ?? {});
  await cancelPayment(actor(req), String(req.params.id), reason);
  res.json({ ok: true });
});

paymentsRouter.delete('/allocations/:id', requirePermission('payment.write'), async (req, res) => {
  await removeAllocation(actor(req), String(req.params.id));
  res.status(204).end();
});

// ------------------------------------------------------------------ expenses
const expenseBody = z.object({
  date: dateStr,
  expenseLedgerId: uuid,
  paidFromId: uuid,
  amount: positiveMoney,
  gstRate: z.coerce.number().min(0).max(100).optional(),
  interState: z.boolean().optional(),
  reference: optStr(100),
  payee: optStr(150),
  notes: optStr(300),
});
paymentsRouter.post('/expenses', requirePermission('voucher.create'), async (req, res) => {
  res.status(201).json(await createExpense(actor(req), expenseBody.parse(req.body)));
});

paymentsRouter.get('/expenses', requirePermission('voucher.read'), async (req, res) => {
  const q = z.object({ from: dateStr.optional(), to: dateStr.optional(), q: z.string().trim().optional(), ...pageQuery }).parse(req.query);
  const a = actor(req);
  const where: Prisma.VoucherWhereInput = {
    companyId: a.companyId, source: 'EXPENSE', reversesId: null,
    ...((q.from || q.to) && { date: { ...(q.from && { gte: parseDate(q.from) }), ...(q.to && { lte: parseDate(q.to) }) } }),
    ...(q.q && { OR: [{ narration: { contains: q.q, mode: 'insensitive' } }, { reference: { contains: q.q, mode: 'insensitive' } }, { number: { contains: q.q, mode: 'insensitive' } }] }),
  };
  const [rows, total, agg] = await Promise.all([
    prisma.voucher.findMany({ where, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { lines: { include: { ledger: { select: { name: true, systemKey: true, group: { select: { nature: true } } } } }, orderBy: { lineNo: 'asc' } } } }),
    prisma.voucher.count({ where }),
    prisma.voucher.aggregate({ where: { ...where, status: 'POSTED' }, _sum: { totalAmount: true } }),
  ]);
  res.json({
    items: rows.map((v) => {
      const exp = v.lines.find((l) => l.side === 'DR' && l.ledger.group.nature === 'EXPENSE');
      const paid = v.lines.find((l) => l.side === 'CR');
      const gst = v.lines.filter((l) => l.ledger.systemKey?.startsWith('INPUT_')).reduce((s, l) => s.plus(D(l.amount)), ZERO);
      return { id: v.id, number: v.number, date: isoDate(v.date), category: exp?.ledger.name ?? '', paidFrom: paid?.ledger.name ?? '', narration: v.narration, reference: v.reference, gst: gst.toFixed(2), total: f2(v.totalAmount), status: v.status };
    }),
    total, page: q.page, pageSize: q.pageSize, totals: { amount: f2(agg._sum.totalAmount) },
  });
});

// ----------------------------------------------------------------- transfers
paymentsRouter.post('/transfers', requirePermission('voucher.create'), async (req, res) => {
  const b = z.object({ date: dateStr, fromId: uuid, toId: uuid, amount: positiveMoney, reference: optStr(100), notes: optStr(300) }).parse(req.body);
  res.status(201).json(await createTransfer(actor(req), b));
});
