import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma, Tx } from '../../lib/prisma';
import { AppError, notFound } from '../../lib/errors';
import { D, f2, r2, ZERO } from '../../lib/money';
import { parseDate, todayIso, isoDate } from '../../lib/dates';
import { actor, authenticate, requirePermission } from '../../middleware/auth';
import { bool, dateStr, money, optStr, pageQuery, rangeQuery } from '../../lib/http';
import { postVoucherTx } from '../accounting/posting.service';
import { systemLedgers } from '../../lib/systemLedgers';
import { assertAvailable, inValueAtAverage, lockProducts, outValue, recordMovement } from './stock.service';

export const productsRouter = Router();

const qty = z.union([z.string().regex(/^\d+(\.\d{1,3})?$/, 'Up to 3 decimals'), z.number().positive()]);

const productBody = z.object({
  sku: optStr(50),
  name: z.string().trim().min(1).max(200),
  kind: z.enum(['GOODS', 'SERVICE']).default('GOODS'),
  category: optStr(100),
  hsn: optStr(20),
  unit: z.string().trim().min(1).max(20).default('Nos'),
  salePrice: money.default('0'),
  purchasePrice: money.default('0'),
  gstRate: z.coerce.number().min(0).max(100).default(0),
  trackStock: z.boolean().default(true),
  reorderLevel: z.union([z.string(), z.number()]).default('0'),
  description: optStr(1000),
  openingQty: qty.optional(),
  openingRate: money.optional(),
  openingDate: dateStr.optional(),
});

async function nextSku(tx: Tx, companyId: string) {
  const n = await tx.product.count({ where: { companyId } });
  for (let i = n + 1; i < n + 1000; i++) {
    const sku = `PRD-${String(i).padStart(4, '0')}`;
    if (!(await tx.product.findUnique({ where: { companyId_sku: { companyId, sku } } }))) return sku;
  }
  throw new AppError(500, 'SKU_ERROR', 'Could not generate a SKU');
}

productsRouter.get('/products', requirePermission('product.read'), async (req, res) => {
  const q = z
    .object({ q: z.string().trim().optional(), kind: z.enum(['GOODS', 'SERVICE']).optional(), category: z.string().optional(), active: bool.optional(), lowStock: bool.optional(), ...pageQuery })
    .parse(req.query);
  const a = actor(req);
  const where: Prisma.ProductWhereInput = {
    companyId: a.companyId,
    ...(q.kind && { kind: q.kind }),
    ...(q.category && { category: q.category }),
    ...(q.active !== undefined && { isActive: q.active }),
    ...(q.q && { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { sku: { contains: q.q, mode: 'insensitive' } }, { hsn: { contains: q.q } }] }),
  };
  if (q.lowStock) {
    const ids = await prisma.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Product" WHERE "companyId" = ${a.companyId} AND "trackStock" AND "kind" = 'GOODS' AND "isActive" AND "onHandQty" <= "reorderLevel"`;
    where.id = { in: ids.map((i) => i.id) };
  }
  const [items, total] = await Promise.all([
    prisma.product.findMany({ where, orderBy: { name: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.product.count({ where }),
  ]);
  res.json({ items, total, page: q.page, pageSize: q.pageSize });
});

productsRouter.get('/products/categories', requirePermission('product.read'), async (req, res) => {
  const rows = await prisma.product.findMany({ where: { companyId: actor(req).companyId, category: { not: null } }, distinct: ['category'], select: { category: true }, orderBy: { category: 'asc' } });
  res.json({ items: rows.map((r) => r.category) });
});

productsRouter.get('/products/:id', requirePermission('product.read'), async (req, res) => {
  const p = await prisma.product.findFirst({ where: { id: String(req.params.id), companyId: actor(req).companyId } });
  if (!p) throw notFound('Product');
  const avg = D(p.onHandQty).gt(0) ? D(p.onHandValue).div(D(p.onHandQty)) : ZERO;
  res.json({ ...p, averageCost: avg.toFixed(2) });
});

productsRouter.post('/products', requirePermission('product.write'), async (req, res) => {
  const body = productBody.parse(req.body);
  const a = actor(req);
  const product = await prisma.$transaction(async (tx) => {
    const sku = body.sku ?? (await nextSku(tx, a.companyId));
    const tracked = body.kind === 'GOODS' && body.trackStock;
    const { openingQty, openingRate, openingDate, ...rest } = body;
    const p = await tx.product.create({
      data: { ...rest, sku, companyId: a.companyId, trackStock: tracked, salePrice: String(rest.salePrice), purchasePrice: String(rest.purchasePrice), gstRate: String(rest.gstRate), reorderLevel: String(rest.reorderLevel) },
    });
    if (tracked && openingQty && D(openingQty).gt(0)) {
      const rate = D(openingRate ?? rest.purchasePrice);
      const value = r2(D(openingQty).times(rate));
      const date = openingDate ?? (await defaultOpeningDate(tx, a.companyId));
      if (value.gt(0)) {
        const sys = await systemLedgers(tx, a.companyId, ['INVENTORY', 'OPENING_EQUITY']);
        const v = await postVoucherTx(tx, a, {
          type: 'JOURNAL', date, source: 'OPENING', narration: `Opening stock - ${p.name}`,
          lines: [{ ledgerId: sys.INVENTORY, side: 'DR', amount: value.toFixed(2) }, { ledgerId: sys.OPENING_EQUITY, side: 'CR', amount: value.toFixed(2) }],
        });
        const st = (await lockProducts(tx, a.companyId, [p.id])).get(p.id)!;
        await recordMovement(tx, a, st, { date: parseDate(date), type: 'OPENING', qty: D(openingQty), value, voucherId: v.id, note: 'Opening stock' });
      }
    }
    await tx.auditLog.create({ data: { companyId: a.companyId, userId: a.userId, action: 'PRODUCT_CREATED', entity: 'Product', entityId: p.id, data: { name: p.name, sku } } });
    return p;
  });
  res.status(201).json(await prisma.product.findUnique({ where: { id: product.id } }));
});

async function defaultOpeningDate(tx: Tx, companyId: string) {
  const today = parseDate(todayIso());
  const fy = await tx.financialYear.findFirst({ where: { companyId, startDate: { lte: today }, endDate: { gte: today } } });
  return fy ? isoDate(fy.startDate) : todayIso();
}

productsRouter.patch('/products/:id', requirePermission('product.write'), async (req, res) => {
  const body = productBody.omit({ openingQty: true, openingRate: true, openingDate: true }).partial().extend({ isActive: z.boolean().optional() }).parse(req.body);
  const a = actor(req);
  const existing = await prisma.product.findFirst({ where: { id: String(req.params.id), companyId: a.companyId } });
  if (!existing) throw notFound('Product');
  if ((body.kind && body.kind !== existing.kind) || (body.trackStock !== undefined && body.trackStock !== existing.trackStock)) {
    const used = (await prisma.stockMovement.count({ where: { productId: existing.id } })) + (await prisma.documentLine.count({ where: { productId: existing.id } }));
    if (used) throw new AppError(409, 'PRODUCT_IN_USE', 'Type and stock tracking cannot change once the product has transactions');
  }
  const data: Prisma.ProductUpdateInput = { ...body } as Prisma.ProductUpdateInput;
  for (const k of ['salePrice', 'purchasePrice', 'gstRate', 'reorderLevel'] as const) if (body[k] !== undefined) (data as Record<string, unknown>)[k] = String(body[k]);
  const p = await prisma.product.update({ where: { id: existing.id }, data });
  await prisma.auditLog.create({ data: { companyId: a.companyId, userId: a.userId, action: 'PRODUCT_UPDATED', entity: 'Product', entityId: p.id, data: { fields: Object.keys(body) } } });
  res.json(p);
});

productsRouter.get('/products/:id/movements', requirePermission('product.read'), async (req, res) => {
  const q = z.object({ ...rangeQuery, ...pageQuery }).parse(req.query);
  const a = actor(req);
  const p = await prisma.product.findFirst({ where: { id: String(req.params.id), companyId: a.companyId }, select: { id: true, name: true, sku: true, unit: true } });
  if (!p) throw notFound('Product');
  const where: Prisma.StockMovementWhereInput = { productId: p.id, companyId: a.companyId, ...((q.from || q.to) && { date: { ...(q.from && { gte: parseDate(q.from) }), ...(q.to && { lte: parseDate(q.to) }) } }) };
  const [items, total] = await Promise.all([
    prisma.stockMovement.findMany({ where, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { document: { select: { id: true, number: true, type: true } } } }),
    prisma.stockMovement.count({ where }),
  ]);
  res.json({ product: p, items, total, page: q.page, pageSize: q.pageSize });
});

// -------------------------------------------------------- stock summary & adjust
productsRouter.get('/stock/summary', requirePermission('product.read'), async (req, res) => {
  const q = z.object({ asOf: dateStr.optional(), q: z.string().trim().optional(), category: z.string().optional() }).parse(req.query);
  const a = actor(req);
  const products = await prisma.product.findMany({
    where: { companyId: a.companyId, kind: 'GOODS', trackStock: true, ...(q.category && { category: q.category }), ...(q.q && { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { sku: { contains: q.q, mode: 'insensitive' } }] }) },
    orderBy: { name: 'asc' },
  });
  let positions = new Map<string, { qty: string; value: string }>();
  if (q.asOf && q.asOf < todayIso()) {
    const rows = await prisma.$queryRaw<{ productId: string; balanceQty: Prisma.Decimal; balanceValue: Prisma.Decimal }[]>`
      SELECT DISTINCT ON ("productId") "productId", "balanceQty", "balanceValue" FROM "StockMovement"
      WHERE "companyId" = ${a.companyId} AND "date" <= ${q.asOf}::date ORDER BY "productId", "date" DESC, "createdAt" DESC`;
    positions = new Map(rows.map((r) => [r.productId, { qty: r.balanceQty.toString(), value: r.balanceValue.toString() }]));
  } else positions = new Map(products.map((p) => [p.id, { qty: p.onHandQty.toString(), value: p.onHandValue.toString() }]));
  let totalValue = ZERO;
  const items = products.map((p) => {
    const pos = positions.get(p.id) ?? { qty: '0', value: '0' };
    const qtyD = D(pos.qty), val = D(pos.value);
    totalValue = totalValue.plus(val);
    return {
      id: p.id, sku: p.sku, name: p.name, category: p.category, unit: p.unit, qty: qtyD.toFixed(3), value: val.toFixed(2),
      averageCost: qtyD.gt(0) ? val.div(qtyD).toFixed(2) : '0.00', reorderLevel: p.reorderLevel.toString(), salePrice: f2(p.salePrice),
      low: p.isActive && qtyD.lte(D(p.reorderLevel)),
    };
  });
  res.json({ asOf: q.asOf ?? todayIso(), items, totalValue: totalValue.toFixed(2) });
});

const adjustBody = z.object({
  productId: z.string().uuid(),
  date: dateStr,
  direction: z.enum(['IN', 'OUT']),
  qty,
  unitCost: money.optional(),
  reason: z.enum(['COUNT_CORRECTION', 'DAMAGE', 'LOSS', 'SAMPLE', 'OTHER']).default('COUNT_CORRECTION'),
  notes: optStr(300),
});
productsRouter.post('/stock/adjustments', requirePermission('stock.adjust'), async (req, res) => {
  const b = adjustBody.parse(req.body);
  const a = actor(req);
  const out = await prisma.$transaction(async (tx) => {
    const company = await tx.company.findUniqueOrThrow({ where: { id: a.companyId } });
    const st = (await lockProducts(tx, a.companyId, [b.productId])).get(b.productId);
    if (!st || !st.trackStock) throw new AppError(422, 'INVALID_PRODUCT', 'Select a stock-tracked product');
    const q = D(b.qty);
    let value: import('decimal.js').default;
    if (b.direction === 'OUT') {
      assertAvailable(st, q, company.allowNegativeStock);
      value = outValue(st, q);
    } else value = b.unitCost !== undefined ? r2(q.times(D(b.unitCost))) : inValueAtAverage(st, q);
    if (value.lte(0)) throw new AppError(422, 'ZERO_VALUE', 'The adjustment has no value - enter a unit cost');
    const sys = await systemLedgers(tx, a.companyId, ['INVENTORY', 'STOCK_ADJUSTMENT']);
    const v = await postVoucherTx(tx, a, {
      type: 'JOURNAL', date: b.date, source: 'ADJUSTMENT',
      narration: `Stock ${b.direction === 'IN' ? 'increase' : 'decrease'} - ${st.name} (${b.reason.replace('_', ' ').toLowerCase()})${b.notes ? `: ${b.notes}` : ''}`,
      lines: b.direction === 'IN'
        ? [{ ledgerId: sys.INVENTORY, side: 'DR', amount: value.toFixed(2) }, { ledgerId: sys.STOCK_ADJUSTMENT, side: 'CR', amount: value.toFixed(2) }]
        : [{ ledgerId: sys.STOCK_ADJUSTMENT, side: 'DR', amount: value.toFixed(2) }, { ledgerId: sys.INVENTORY, side: 'CR', amount: value.toFixed(2) }],
    });
    await recordMovement(tx, a, st, {
      date: parseDate(b.date), type: b.direction === 'IN' ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
      qty: b.direction === 'IN' ? q : q.neg(), value: b.direction === 'IN' ? value : value.neg(), voucherId: v.id, note: `${b.reason}${b.notes ? `: ${b.notes}` : ''}`,
    });
    await tx.auditLog.create({ data: { companyId: a.companyId, userId: a.userId, action: 'STOCK_ADJUSTED', entity: 'Product', entityId: b.productId, data: { direction: b.direction, qty: q.toString(), value: value.toFixed(2), reason: b.reason } } });
    return { voucherNumber: v.number, value: value.toFixed(2) };
  });
  res.status(201).json(out);
});

