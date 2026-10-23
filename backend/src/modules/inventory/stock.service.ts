import Decimal from 'decimal.js';
import { Prisma, StockMoveType } from '@prisma/client';
import type { Tx } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { D, r2 } from '../../lib/money';

/** In-memory view of a product's running stock position while a transaction is being built. */
export interface StockState {
  id: string;
  name: string;
  trackStock: boolean;
  purchasePrice: Decimal;
  qty: Decimal;
  value: Decimal;
}

/** Lock the given products (in id order, to avoid deadlocks) and return their current stock position. */
export async function lockProducts(tx: Tx, companyId: string, ids: string[]): Promise<Map<string, StockState>> {
  const unique = [...new Set(ids)].sort();
  const map = new Map<string, StockState>();
  if (!unique.length) return map;
  await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "companyId" = ${companyId} AND "id" IN (${Prisma.join(unique)}) ORDER BY "id" FOR UPDATE`;
  const rows = await tx.product.findMany({ where: { companyId, id: { in: unique } } });
  for (const p of rows) {
    map.set(p.id, { id: p.id, name: p.name, trackStock: p.kind === 'GOODS' && p.trackStock, purchasePrice: D(p.purchasePrice), qty: D(p.onHandQty), value: D(p.onHandValue) });
  }
  return map;
}

/** Value of `qty` units leaving stock at the current weighted-average cost. */
export function outValue(s: StockState, qty: Decimal): Decimal {
  if (s.qty.lte(0)) return r2(qty.times(s.purchasePrice)); // negative / empty stock: fall back to last purchase price
  if (qty.gte(s.qty)) return r2(s.value); // last units take the whole remaining value (no rounding residue)
  return r2(s.value.div(s.qty).times(qty));
}

/** Value of `qty` units entering stock without a stated price (returns, adjustments) at current average cost. */
export function inValueAtAverage(s: StockState, qty: Decimal): Decimal {
  if (s.qty.gt(0) && s.value.gt(0)) return r2(s.value.div(s.qty).times(qty));
  return r2(qty.times(s.purchasePrice));
}

export function assertAvailable(s: StockState, qty: Decimal, allowNegative: boolean) {
  if (!allowNegative && s.qty.lt(qty)) {
    throw new AppError(422, 'INSUFFICIENT_STOCK', `Insufficient stock for "${s.name}": available ${s.qty.toString()}, required ${qty.toString()}`, {
      productId: s.id,
      available: s.qty.toString(),
      required: qty.toString(),
    });
  }
}

/** Apply a signed movement to the in-memory state, persist it and update the product's running totals. */
export async function recordMovement(
  tx: Tx,
  ctx: { companyId: string; userId: string },
  state: StockState,
  m: { date: Date; type: StockMoveType; qty: Decimal; value: Decimal; documentId?: string | undefined; voucherId?: string | undefined; note?: string | undefined },
) {
  state.qty = state.qty.plus(m.qty);
  state.value = state.value.plus(m.value);
  await tx.stockMovement.create({
    data: {
      companyId: ctx.companyId,
      productId: state.id,
      date: m.date,
      type: m.type,
      qty: m.qty.toFixed(3),
      value: m.value.toFixed(2),
      balanceQty: state.qty.toFixed(3),
      balanceValue: state.value.toFixed(2),
      documentId: m.documentId ?? null,
      voucherId: m.voucherId ?? null,
      note: m.note ?? null,
      createdById: ctx.userId,
    },
  });
  await tx.product.update({ where: { id: state.id }, data: { onHandQty: state.qty.toFixed(3), onHandValue: state.value.toFixed(2) } });
}
