import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError, notFound } from '../../lib/errors';
import { todayIso, isoDate, parseDate } from '../../lib/dates';
import { D, f2 } from '../../lib/money';
import { actor, requirePermission } from '../../middleware/auth';
import { bool, dateStr, optStr, pageQuery } from '../../lib/http';
import { ledgerBalances } from '../../lib/balances';
import { postVoucher, reverseVoucher } from './posting.service';
import { ledgerStatement, trialBalance } from './reports.service';

export const accountingRouter = Router();

const money = z.union([z.string().regex(/^\d+(\.\d{1,2})?$/, 'Invalid amount'), z.number().nonnegative()]);

// ---------- Financial years ----------
accountingRouter.get('/financial-years', requirePermission('company.read'), async (req, res) => {
  const items = await prisma.financialYear.findMany({ where: { companyId: actor(req).companyId }, orderBy: { startDate: 'desc' } });
  res.json({ items });
});

// ---------- Account groups ----------
accountingRouter.get('/account-groups', requirePermission('ledger.read'), async (req, res) => {
  const items = await prisma.accountGroup.findMany({ where: { companyId: actor(req).companyId }, orderBy: { name: 'asc' } });
  res.json({ items });
});

const groupSchema = z.object({
  name: z.string().trim().min(1).max(100),
  parentId: z.string().uuid(),
});
accountingRouter.post('/account-groups', requirePermission('ledger.write'), async (req, res) => {
  const body = groupSchema.parse(req.body);
  const a = actor(req);
  const parent = await prisma.accountGroup.findFirst({ where: { id: body.parentId, companyId: a.companyId } });
  if (!parent) throw new AppError(422, 'INVALID_PARENT', 'Parent group not found');
  const group = await prisma.accountGroup.create({
    data: { companyId: a.companyId, name: body.name, parentId: parent.id, nature: parent.nature },
  });
  await prisma.auditLog.create({ data: { companyId: a.companyId, userId: a.userId, action: 'GROUP_CREATED', entity: 'AccountGroup', entityId: group.id, data: { name: group.name } } });
  res.status(201).json(group);
});

accountingRouter.patch('/account-groups/:id', requirePermission('ledger.write'), async (req, res) => {
  const body = z.object({ name: z.string().trim().min(1).max(100) }).parse(req.body);
  const a = actor(req);
  const g = await prisma.accountGroup.findFirst({ where: { id: String(req.params.id), companyId: a.companyId } });
  if (!g) throw notFound('Group');
  if (g.isSystem) throw new AppError(409, 'SYSTEM_GROUP', 'Built-in groups cannot be renamed');
  res.json(await prisma.accountGroup.update({ where: { id: g.id }, data: { name: body.name } }));
});

accountingRouter.delete('/account-groups/:id', requirePermission('ledger.write'), async (req, res) => {
  const a = actor(req);
  const g = await prisma.accountGroup.findFirst({ where: { id: String(req.params.id), companyId: a.companyId } });
  if (!g) throw notFound('Group');
  if (g.isSystem) throw new AppError(409, 'SYSTEM_GROUP', 'Built-in groups cannot be deleted');
  if ((await prisma.ledger.count({ where: { groupId: g.id } })) + (await prisma.accountGroup.count({ where: { parentId: g.id } }))) {
    throw new AppError(409, 'GROUP_NOT_EMPTY', 'Move or delete the ledgers and sub-groups first');
  }
  await prisma.accountGroup.delete({ where: { id: g.id } });
  res.status(204).end();
});

// ---------- Ledgers ----------
accountingRouter.get('/ledgers', requirePermission('ledger.read'), async (req, res) => {
  const q = z.object({ q: z.string().trim().optional(), groupId: z.string().uuid().optional(), nature: z.enum(['ASSET', 'LIABILITY', 'INCOME', 'EXPENSE']).optional(), active: bool.optional(), withBalance: bool.optional(), asOf: dateStr.optional() }).parse(req.query);
  const a = actor(req);
  const items = await prisma.ledger.findMany({
    where: {
      companyId: a.companyId,
      ...(q.groupId && { groupId: q.groupId }),
      ...(q.active !== undefined && { isActive: q.active }),
      ...(q.nature && { group: { nature: q.nature } }),
      ...(q.q && { name: { contains: q.q, mode: 'insensitive' } }),
    },
    include: { group: { select: { id: true, name: true, nature: true } }, party: { select: { id: true, type: true } } },
    orderBy: { name: 'asc' },
  });
  if (!q.withBalance) return res.json({ items });
  const bal = await ledgerBalances(a.companyId, q.asOf ?? todayIso());
  res.json({
    items: items.map((l) => {
      const b = bal.get(l.id) ?? D(0);
      return { ...l, balance: b.abs().toFixed(2), balanceSide: b.gte(0) ? 'DR' : 'CR' };
    }),
  });
});

const ledgerSchema = z.object({
  name: z.string().trim().min(1).max(150),
  groupId: z.string().uuid(),
  code: z.string().trim().max(50).optional(),
  description: optStr(300),
  openingBalance: money.default('0'),
  openingSide: z.enum(['DR', 'CR']).default('DR'),
});
accountingRouter.post('/ledgers', requirePermission('ledger.write'), async (req, res) => {
  const body = ledgerSchema.parse(req.body);
  const a = actor(req);
  const group = await prisma.accountGroup.findFirst({ where: { id: body.groupId, companyId: a.companyId } });
  if (!group) throw new AppError(422, 'INVALID_GROUP', 'Account group not found');
  if (['Sundry Debtors', 'Sundry Creditors'].includes(group.name)) {
    throw new AppError(422, 'USE_PARTIES', 'Create customers and suppliers from the Customers / Suppliers pages so they get a party record');
  }
  const ledger = await prisma.$transaction(async (tx) => {
    const l = await tx.ledger.create({
      data: {
        companyId: a.companyId,
        groupId: group.id,
        name: body.name,
        code: body.code ?? null,
        description: body.description ?? null,
        openingBalance: String(body.openingBalance),
        openingSide: body.openingSide,
      },
    });
    await tx.auditLog.create({ data: { companyId: a.companyId, userId: a.userId, action: 'LEDGER_CREATED', entity: 'Ledger', entityId: l.id, data: { name: l.name } } });
    return l;
  });
  res.status(201).json(ledger);
});

accountingRouter.patch('/ledgers/:id', requirePermission('ledger.write'), async (req, res) => {
  const body = ledgerSchema.partial().extend({ isActive: z.boolean().optional() }).parse(req.body);
  const a = actor(req);
  const l = await prisma.ledger.findFirst({ where: { id: String(req.params.id), companyId: a.companyId }, include: { group: true, party: true } });
  if (!l) throw notFound('Ledger');
  if (l.isSystem && (body.name || body.groupId || body.isActive === false)) {
    throw new AppError(409, 'SYSTEM_LEDGER', 'System ledgers cannot be renamed, moved or deactivated');
  }
  if (l.party && (body.name || body.groupId)) throw new AppError(409, 'PARTY_LEDGER', 'Edit the name of customers / suppliers from their own page');
  if (body.groupId && body.groupId !== l.groupId) {
    const g = await prisma.accountGroup.findFirst({ where: { id: body.groupId, companyId: a.companyId } });
    if (!g) throw new AppError(422, 'INVALID_GROUP', 'Account group not found');
    if (g.nature !== l.group.nature && (await prisma.voucherLine.count({ where: { ledgerId: l.id } }))) {
      throw new AppError(409, 'NATURE_CHANGE', 'A ledger with postings cannot move to a group of a different nature');
    }
  }
  const { openingBalance, ...rest } = body;
  const updated = await prisma.ledger.update({ where: { id: l.id }, data: { ...rest, ...(openingBalance !== undefined && { openingBalance: String(openingBalance) }) } });
  await prisma.auditLog.create({ data: { companyId: a.companyId, userId: a.userId, action: 'LEDGER_UPDATED', entity: 'Ledger', entityId: l.id, data: { fields: Object.keys(body) } } });
  res.json(updated);
});

accountingRouter.delete('/ledgers/:id', requirePermission('ledger.write'), async (req, res) => {
  const a = actor(req);
  const l = await prisma.ledger.findFirst({ where: { id: String(req.params.id), companyId: a.companyId }, include: { party: true } });
  if (!l) throw notFound('Ledger');
  if (l.isSystem || l.party) throw new AppError(409, 'LEDGER_PROTECTED', 'System and party ledgers cannot be deleted');
  if (await prisma.voucherLine.count({ where: { ledgerId: l.id } })) throw new AppError(409, 'LEDGER_IN_USE', 'This ledger has postings. Deactivate it instead.');
  await prisma.ledger.delete({ where: { id: l.id } });
  await prisma.auditLog.create({ data: { companyId: a.companyId, userId: a.userId, action: 'LEDGER_DELETED', entity: 'Ledger', entityId: l.id, data: { name: l.name } } });
  res.status(204).end();
});

const rangeSchema = z.object({ from: dateStr.optional(), to: dateStr.optional() });

accountingRouter.get('/ledgers/:id/statement', requirePermission('report.read'), async (req, res) => {
  const q = rangeSchema.parse(req.query);
  const a = actor(req);
  const to = q.to ?? todayIso();
  let from = q.from;
  if (!from) {
    const fy = await prisma.financialYear.findFirst({ where: { companyId: a.companyId, startDate: { lte: parseDate(to) }, endDate: { gte: parseDate(to) } } });
    from = fy ? isoDate(fy.startDate) : to;
  }
  res.json(await ledgerStatement(a.companyId, String(req.params.id), from, to));
});

// ---------- Vouchers ----------
const voucherTypes = ['SALES', 'PURCHASE', 'PAYMENT', 'RECEIPT', 'CONTRA', 'JOURNAL', 'CREDIT_NOTE', 'DEBIT_NOTE'] as const;
const voucherSchema = z.object({
  type: z.enum(voucherTypes),
  date: dateStr,
  narration: z.string().trim().max(500).optional(),
  reference: z.string().trim().max(100).optional(),
  lines: z
    .array(z.object({ ledgerId: z.string().uuid(), side: z.enum(['DR', 'CR']), amount: money, narration: z.string().trim().max(500).optional() }))
    .min(2)
    .max(200),
});

accountingRouter.post('/vouchers', requirePermission('voucher.create'), async (req, res) => {
  const body = voucherSchema.parse(req.body);
  const voucher = await postVoucher(actor(req), { ...body, source: 'MANUAL' });
  res.status(201).json(voucher);
});

const listSchema = z.object({
  type: z.enum(voucherTypes).optional(),
  status: z.enum(['POSTED', 'REVERSED']).optional(),
  source: z.string().optional(),
  ledgerId: z.string().uuid().optional(),
  q: z.string().trim().optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  includeLines: bool.optional(),
  ...pageQuery,
});
accountingRouter.get('/vouchers', requirePermission('voucher.read'), async (req, res) => {
  const q = listSchema.parse(req.query);
  const where: Prisma.VoucherWhereInput = {
    companyId: actor(req).companyId,
    ...(q.type && { type: q.type }),
    ...(q.status && { status: q.status }),
    ...(q.source && { source: q.source }),
    ...(q.ledgerId && { lines: { some: { ledgerId: q.ledgerId } } }),
    ...(q.q && { OR: [{ number: { contains: q.q, mode: 'insensitive' } }, { narration: { contains: q.q, mode: 'insensitive' } }, { reference: { contains: q.q, mode: 'insensitive' } }] }),
    ...((q.from || q.to) && { date: { ...(q.from && { gte: parseDate(q.from) }), ...(q.to && { lte: parseDate(q.to) }) } }),
  };
  const [items, total] = await Promise.all([
    prisma.voucher.findMany({
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      ...(q.includeLines && { include: { lines: { orderBy: { lineNo: 'asc' as const }, include: { ledger: { select: { id: true, name: true } } } } } }),
    }),
    prisma.voucher.count({ where }),
  ]);
  res.json({ items, total, page: q.page, pageSize: q.pageSize });
});

accountingRouter.get('/vouchers/:id', requirePermission('voucher.read'), async (req, res) => {
  const a = actor(req);
  const v = await prisma.voucher.findFirst({
    where: { id: String(req.params.id), companyId: a.companyId },
    include: {
      lines: { orderBy: { lineNo: 'asc' }, include: { ledger: { select: { id: true, name: true } } } },
      document: { select: { id: true, number: true, type: true } },
      payment: { select: { id: true, direction: true } },
      reverses: { select: { id: true, number: true } },
      reversedBy: { select: { id: true, number: true } },
    },
  });
  if (!v) throw notFound('Voucher');
  const createdBy = await prisma.user.findUnique({ where: { id: v.createdById }, select: { name: true } });
  res.json({ ...v, createdByName: createdBy?.name ?? null });
});

const reverseSchema = z.object({ date: dateStr.optional(), reason: z.string().trim().max(300).optional() });
accountingRouter.post('/vouchers/:id/reverse', requirePermission('voucher.reverse'), async (req, res) => {
  const body = reverseSchema.parse(req.body ?? {});
  const a = actor(req);
  const id = String(req.params.id);
  const linked = await prisma.voucher.findFirst({ where: { id, companyId: a.companyId }, select: { document: { select: { number: true } }, payment: { select: { id: true } }, source: true } });
  if (linked?.document) throw new AppError(409, 'USE_DOCUMENT_CANCEL', `This voucher belongs to ${linked.document.number}. Cancel the invoice / bill from its own page.`);
  if (linked?.payment) throw new AppError(409, 'USE_PAYMENT_CANCEL', 'This voucher belongs to a receipt / payment. Cancel it from the Receipts / Payments page.');
  if (linked?.source === 'CLOSING') throw new AppError(409, 'USE_REOPEN', 'Year-end closing entries are undone by re-opening the financial year.');
  const reversal = await reverseVoucher(a, id, body);
  res.status(201).json(reversal);
});

// ---------- Reports ----------
accountingRouter.get('/reports/trial-balance', requirePermission('report.read'), async (req, res) => {
  const q = rangeSchema.parse(req.query);
  res.json(await trialBalance(actor(req).companyId, q.from, q.to ?? todayIso()));
});

