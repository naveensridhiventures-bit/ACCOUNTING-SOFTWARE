import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError, notFound } from '../../lib/errors';
import { D, f2, ZERO } from '../../lib/money';
import { actor, authenticate, requirePermission } from '../../middleware/auth';
import { bool, gstin, money, optStr, pageQuery, pan, uuid } from '../../lib/http';
import { ledgerBalances } from '../../lib/balances';
import { outstandingMap, isSettleable } from '../sales/documents.service';
import { isoDate, todayIso } from '../../lib/dates';

export const partiesRouter = Router();

const emptyToUndef = (s: z.ZodTypeAny) => z.preprocess((v) => (v === '' || v === null ? undefined : v), s);

const partyBody = z.object({
  type: z.enum(['CUSTOMER', 'SUPPLIER']),
  name: z.string().trim().min(1).max(150),
  gstin: emptyToUndef(gstin.optional()),
  pan: emptyToUndef(pan.optional()),
  phone: optStr(30),
  email: emptyToUndef(z.string().trim().email().max(150).optional()),
  contactPerson: optStr(100),
  billingAddress: optStr(500),
  city: optStr(100),
  state: optStr(100),
  stateCode: emptyToUndef(z.string().regex(/^\d{2}$/, 'State code is two digits').optional()),
  pincode: optStr(10),
  creditDays: z.coerce.number().int().min(0).max(365).default(0),
  creditLimit: emptyToUndef(money.optional()),
  notes: optStr(1000),
  openingBalance: money.default('0'),
  openingSide: z.enum(['DR', 'CR']).optional(),
});

partiesRouter.get('/parties', requirePermission('party.read'), async (req, res) => {
  const q = z
    .object({ type: z.enum(['CUSTOMER', 'SUPPLIER']).optional(), q: z.string().trim().optional(), active: bool.optional(), withBalance: bool.optional(), ...pageQuery })
    .parse(req.query);
  const a = actor(req);
  const where: Prisma.PartyWhereInput = {
    companyId: a.companyId,
    ...(q.type && { type: q.type }),
    ...(q.active !== undefined && { isActive: q.active }),
    ...(q.q && { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { gstin: { contains: q.q, mode: 'insensitive' } }, { phone: { contains: q.q } }, { email: { contains: q.q, mode: 'insensitive' } }] }),
  };
  const [items, total] = await Promise.all([
    prisma.party.findMany({ where, orderBy: { name: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.party.count({ where }),
  ]);
  let balances: Map<string, import('decimal.js').default> | undefined;
  if (q.withBalance) balances = await ledgerBalances(a.companyId, todayIso(), items.map((i) => i.ledgerId));
  res.json({
    items: items.map((p) => {
      const bal = balances?.get(p.ledgerId);
      // Customers owe us when DR; suppliers are owed when CR. `balance` is always "amount due" with a sign for the unusual direction.
      const due = bal ? (p.type === 'CUSTOMER' ? bal : bal.neg()) : undefined;
      return { ...p, ...(due && { balance: due.toFixed(2) }) };
    }),
    total, page: q.page, pageSize: q.pageSize,
  });
});

partiesRouter.get('/parties/:id', requirePermission('party.read'), async (req, res) => {
  const a = actor(req);
  const p = await prisma.party.findFirst({ where: { id: String(req.params.id), companyId: a.companyId }, include: { ledger: { select: { id: true, openingBalance: true, openingSide: true } } } });
  if (!p) throw notFound('Party');
  const bal = (await ledgerBalances(a.companyId, todayIso(), [p.ledgerId])).get(p.ledgerId) ?? ZERO;
  const docs = await prisma.document.findMany({ where: { partyId: p.id, status: 'ACTIVE' }, select: { id: true, type: true, total: true, status: true, dueDate: true } });
  const out = await outstandingMap(prisma, docs);
  let outstanding = ZERO, overdue = ZERO;
  const today = todayIso();
  for (const d of docs) {
    if (!isSettleable(d.type)) continue;
    const o = out.get(d.id) ?? ZERO;
    outstanding = outstanding.plus(o);
    if (d.dueDate && isoDate(d.dueDate) < today) overdue = overdue.plus(o);
  }
  const due = p.type === 'CUSTOMER' ? bal : bal.neg();
  res.json({ ...p, balance: due.toFixed(2), outstanding: outstanding.toFixed(2), overdue: overdue.toFixed(2) });
});

partiesRouter.post('/parties', requirePermission('party.write'), async (req, res) => {
  const body = partyBody.parse(req.body);
  const a = actor(req);
  const party = await prisma.$transaction(async (tx) => {
    const groupName = body.type === 'CUSTOMER' ? 'Sundry Debtors' : 'Sundry Creditors';
    const group = await tx.accountGroup.findUnique({ where: { companyId_name: { companyId: a.companyId, name: groupName } } });
    if (!group) throw new AppError(500, 'MISSING_GROUP', `Group "${groupName}" is missing. Run "npm run seed".`);
    if (await tx.ledger.findUnique({ where: { companyId_name: { companyId: a.companyId, name: body.name } } })) {
      throw new AppError(409, 'CONFLICT', `An account named "${body.name}" already exists`);
    }
    const side = body.openingSide ?? (body.type === 'CUSTOMER' ? 'DR' : 'CR');
    const ledger = await tx.ledger.create({
      data: { companyId: a.companyId, groupId: group.id, name: body.name, openingBalance: String(body.openingBalance), openingSide: side },
    });
    const { openingBalance: _ob, openingSide: _os, creditLimit, ...rest } = body;
    const p = await tx.party.create({ data: { ...rest, companyId: a.companyId, ledgerId: ledger.id, creditLimit: creditLimit != null ? String(creditLimit) : null } });
    await tx.auditLog.create({ data: { companyId: a.companyId, userId: a.userId, action: 'PARTY_CREATED', entity: 'Party', entityId: p.id, data: { name: p.name, type: p.type } } });
    return p;
  });
  res.status(201).json(party);
});

partiesRouter.patch('/parties/:id', requirePermission('party.write'), async (req, res) => {
  const body = partyBody.omit({ type: true, openingBalance: true, openingSide: true }).partial().extend({ isActive: z.boolean().optional() }).parse(req.body);
  const a = actor(req);
  const existing = await prisma.party.findFirst({ where: { id: String(req.params.id), companyId: a.companyId } });
  if (!existing) throw notFound('Party');
  const updated = await prisma.$transaction(async (tx) => {
    const { creditLimit, ...rest } = body;
    const p = await tx.party.update({ where: { id: existing.id }, data: { ...rest, ...(creditLimit !== undefined && { creditLimit: String(creditLimit) }) } });
    if (body.name || body.isActive !== undefined) {
      await tx.ledger.update({ where: { id: existing.ledgerId }, data: { ...(body.name && { name: body.name }), ...(body.isActive !== undefined && { isActive: body.isActive }) } });
    }
    await tx.auditLog.create({ data: { companyId: a.companyId, userId: a.userId, action: 'PARTY_UPDATED', entity: 'Party', entityId: p.id, data: { fields: Object.keys(body) } } });
    return p;
  });
  res.json(updated);
});

/** Everything that can be settled for a party: open invoices/bills, unapplied payments, unapplied notes. */
partiesRouter.get('/parties/:id/open-items', requirePermission('party.read'), async (req, res) => {
  const a = actor(req);
  const p = await prisma.party.findFirst({ where: { id: String(req.params.id), companyId: a.companyId } });
  if (!p) throw notFound('Party');
  const docs = await prisma.document.findMany({ where: { partyId: p.id, companyId: a.companyId, status: 'ACTIVE' }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] });
  const out = await outstandingMap(prisma, docs);
  const mapDoc = (d: (typeof docs)[number]) => ({ id: d.id, type: d.type, number: d.number, date: isoDate(d.date), dueDate: d.dueDate ? isoDate(d.dueDate) : null, total: f2(d.total), outstanding: f2(out.get(d.id)) });
  const payments = await prisma.payment.findMany({ where: { partyId: p.id, status: 'ACTIVE' }, orderBy: { date: 'asc' } });
  const used = await prisma.allocation.groupBy({ by: ['paymentId'], where: { paymentId: { in: payments.map((x) => x.id) } }, _sum: { amount: true } });
  const usedMap = new Map(used.map((u) => [u.paymentId, D(u._sum.amount)]));
  res.json({
    documents: docs.filter((d) => isSettleable(d.type) && (out.get(d.id) ?? ZERO).gt(0)).map(mapDoc),
    notes: docs.filter((d) => !isSettleable(d.type) && (out.get(d.id) ?? ZERO).gt(0)).map(mapDoc),
    payments: payments
      .map((x) => ({ id: x.id, date: isoDate(x.date), amount: f2(x.amount), unallocated: D(x.amount).minus(usedMap.get(x.id) ?? ZERO).toFixed(2), reference: x.reference }))
      .filter((x) => D(x.unallocated).gt(0)),
  });
});
