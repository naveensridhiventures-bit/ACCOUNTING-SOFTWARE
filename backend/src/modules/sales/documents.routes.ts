import { Router } from 'express';
import { z } from 'zod';
import { DocType, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError, notFound } from '../../lib/errors';
import { D, f2, ZERO } from '../../lib/money';
import { isoDate, parseDate, todayIso } from '../../lib/dates';
import { actor, assertCan, authenticate, can } from '../../middleware/auth';
import { dateStr, optStr, pageQuery, positiveMoney, uuid } from '../../lib/http';
import { applyNoteTx, cancelDocument, createDocument, isSettleable, outstandingMap, paymentStatusOf } from './documents.service';

export const documentsRouter = Router();

const TYPES = ['SALES_INVOICE', 'PURCHASE_BILL', 'CREDIT_NOTE', 'DEBIT_NOTE'] as const;
const isSales = (t: DocType) => t === 'SALES_INVOICE' || t === 'CREDIT_NOTE';
const readPerm = (t: DocType) => (isSales(t) ? 'sales.read' : 'purchase.read');
const writePerm = (t: DocType) => (isSales(t) ? 'sales.write' : 'purchase.write');

const lineSchema = z.object({
  productId: uuid.optional().nullable().transform((v) => v ?? undefined),
  ledgerId: uuid.optional().nullable().transform((v) => v ?? undefined),
  description: optStr(300),
  hsn: optStr(20),
  unit: optStr(20),
  qty: z.union([z.string().regex(/^\d+(\.\d{1,3})?$/, 'Quantity: up to 3 decimals'), z.number().positive()]),
  rate: z.union([z.string().regex(/^\d+(\.\d{1,2})?$/, 'Rate: up to 2 decimals'), z.number().nonnegative()]).optional(),
  discountPct: z.coerce.number().min(0).max(100).optional(),
  gstRate: z.coerce.number().min(0).max(100).optional(),
});
const createSchema = z.object({
  type: z.enum(TYPES),
  date: dateStr,
  dueDate: dateStr.optional().nullable().transform((v) => v ?? undefined),
  partyId: uuid,
  reference: optStr(100),
  placeOfSupplyCode: z.string().regex(/^\d{2}$/).optional().nullable().transform((v) => v ?? undefined),
  notes: optStr(1000),
  terms: optStr(2000),
  originalDocumentId: uuid.optional().nullable().transform((v) => v ?? undefined),
  applyTo: z.array(z.object({ documentId: uuid, amount: positiveMoney })).max(100).optional(),
  lines: z.array(lineSchema).min(1).max(200),
});

documentsRouter.post('/documents', async (req, res) => {
  const body = createSchema.parse(req.body);
  assertCan(req, writePerm(body.type));
  const doc = await createDocument(actor(req), body);
  res.status(201).json(doc);
});

const listQuery = z.object({
  type: z.string().optional(), // comma separated
  partyId: uuid.optional(),
  status: z.enum(['ACTIVE', 'CANCELLED']).optional(),
  paymentStatus: z.enum(['UNPAID', 'PARTIAL', 'PAID', 'OVERDUE', 'OPEN']).optional(),
  q: z.string().trim().optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  ...pageQuery,
});

documentsRouter.get('/documents', async (req, res) => {
  const q = listQuery.parse(req.query);
  const a = actor(req);
  const requested = (q.type ? q.type.split(',') : [...TYPES]).filter((t): t is DocType => (TYPES as readonly string[]).includes(t));
  const types = requested.filter((t) => can(req, readPerm(t)));
  if (!types.length) throw new AppError(403, 'FORBIDDEN', 'Missing permission to view these documents');

  const where: Prisma.DocumentWhereInput = {
    companyId: a.companyId,
    type: { in: types },
    ...(q.partyId && { partyId: q.partyId }),
    ...(q.status && { status: q.status }),
    ...((q.from || q.to) && { date: { ...(q.from && { gte: parseDate(q.from) }), ...(q.to && { lte: parseDate(q.to) }) } }),
    ...(q.q && { OR: [{ number: { contains: q.q, mode: 'insensitive' } }, { reference: { contains: q.q, mode: 'insensitive' } }, { party: { name: { contains: q.q, mode: 'insensitive' } } }] }),
  };
  const include = { party: { select: { id: true, name: true, gstin: true } } } as const;
  const today = todayIso();
  const shape = (d: Prisma.DocumentGetPayload<{ include: typeof include }>, out: Map<string, import('decimal.js').default>) => {
    const outstanding = out.get(d.id) ?? ZERO;
    return {
      id: d.id, type: d.type, number: d.number, date: isoDate(d.date), dueDate: d.dueDate ? isoDate(d.dueDate) : null,
      party: d.party, reference: d.reference, taxable: f2(d.taxableTotal), tax: f2(D(d.cgstTotal).plus(d.sgstTotal).plus(d.igstTotal)), total: f2(d.total),
      balance: f2(outstanding), paid: f2(D(d.total).minus(outstanding)), status: d.status,
      paymentStatus: paymentStatusOf(D(d.total), outstanding, d.status),
      overdue: isSettleable(d.type) && d.status === 'ACTIVE' && outstanding.gt(0) && !!d.dueDate && isoDate(d.dueDate) < today,
    };
  };

  if (q.paymentStatus) {
    // Payment status depends on allocations, so filter after computing (bounded to keep it cheap).
    const all = await prisma.document.findMany({ where: { ...where, type: { in: types.filter(isSettleable) }, status: 'ACTIVE' }, include, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 3000 });
    const out = await outstandingMap(prisma, all);
    const shaped = all.map((d) => shape(d, out)).filter((d) => (q.paymentStatus === 'OVERDUE' ? d.overdue : q.paymentStatus === 'OPEN' ? d.paymentStatus !== 'PAID' : d.paymentStatus === q.paymentStatus));
    const items = shaped.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
    const totals = shaped.reduce((t, d) => ({ total: t.total.plus(d.total), balance: t.balance.plus(d.balance) }), { total: ZERO, balance: ZERO });
    return res.json({ items, total: shaped.length, page: q.page, pageSize: q.pageSize, totals: { total: totals.total.toFixed(2), balance: totals.balance.toFixed(2) } });
  }

  const [rows, total, agg] = await Promise.all([
    prisma.document.findMany({ where, include, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.document.count({ where }),
    prisma.document.aggregate({ where: { ...where, status: 'ACTIVE' }, _sum: { total: true, taxableTotal: true } }),
  ]);
  const out = await outstandingMap(prisma, rows);
  res.json({ items: rows.map((d) => shape(d, out)), total, page: q.page, pageSize: q.pageSize, totals: { total: f2(agg._sum.total), taxable: f2(agg._sum.taxableTotal) } });
});

documentsRouter.get('/documents/:id', async (req, res) => {
  const a = actor(req);
  const d = await prisma.document.findFirst({
    where: { id: String(req.params.id), companyId: a.companyId },
    include: {
      party: true,
      lines: { orderBy: { lineNo: 'asc' }, include: { product: { select: { id: true, sku: true, name: true } } } },
      voucher: { select: { id: true, number: true, type: true } },
      originalDocument: { select: { id: true, number: true, type: true } },
      linkedDocuments: { select: { id: true, number: true, type: true, total: true, status: true } },
      allocations: { include: { payment: { select: { id: true, date: true, reference: true, mode: true, voucher: { select: { number: true } } } }, creditDocument: { select: { id: true, number: true, type: true } } } },
      creditAllocations: { include: { document: { select: { id: true, number: true, type: true } } } },
    },
  });
  if (!d) throw notFound('Document');
  assertCan(req, readPerm(d.type));
  const out = await outstandingMap(prisma, [d]);
  const createdBy = await prisma.user.findUnique({ where: { id: d.createdById }, select: { name: true } });
  const balance = out.get(d.id) ?? ZERO;
  res.json({
    ...d,
    balance: balance.toFixed(2),
    paid: D(d.total).minus(balance).toFixed(2),
    paymentStatus: paymentStatusOf(D(d.total), balance, d.status),
    overdue: isSettleable(d.type) && d.status === 'ACTIVE' && balance.gt(0) && !!d.dueDate && isoDate(d.dueDate) < todayIso(),
    createdByName: createdBy?.name ?? null,
  });
});

documentsRouter.post('/documents/:id/cancel', async (req, res) => {
  assertCan(req, 'document.cancel');
  const { reason } = z.object({ reason: optStr(300) }).parse(req.body ?? {});
  res.json(await cancelDocument(actor(req), String(req.params.id), reason));
});

/** Apply a credit / debit note against open invoices / bills of the same party. */
documentsRouter.post('/documents/:id/apply', async (req, res) => {
  const a = actor(req);
  const { items } = z.object({ items: z.array(z.object({ documentId: uuid, amount: positiveMoney })).min(1).max(100) }).parse(req.body);
  const note = await prisma.document.findFirst({ where: { id: String(req.params.id), companyId: a.companyId } });
  if (!note) throw notFound('Document');
  assertCan(req, writePerm(note.type));
  await prisma.$transaction(async (tx) => {
    await applyNoteTx(tx, a, note.id, items);
    await tx.auditLog.create({ data: { companyId: a.companyId, userId: a.userId, action: 'NOTE_APPLIED', entity: 'Document', entityId: note.id, data: { number: note.number, items } as object } });
  });
  res.json({ ok: true });
});
