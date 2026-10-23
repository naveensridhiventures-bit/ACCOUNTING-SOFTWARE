import Decimal from 'decimal.js';
import { DocType, EntrySide, Prisma, StockMoveType, VoucherType } from '@prisma/client';
import { prisma, Tx } from '../../lib/prisma';
import { AppError, notFound } from '../../lib/errors';
import { D, r2, f2, ZERO } from '../../lib/money';
import { isoDate, parseDate } from '../../lib/dates';
import { Actor, LineInput, postVoucherTx, reverseVoucherTx } from '../accounting/posting.service';
import { systemLedgers } from '../../lib/systemLedgers';
import { assertAvailable, inValueAtAverage, lockProducts, outValue, recordMovement, StockState } from '../inventory/stock.service';

export const DOC_META: Record<DocType, { voucherType: VoucherType; partyType: 'CUSTOMER' | 'SUPPLIER'; label: string; partySide: EntrySide }> = {
  SALES_INVOICE: { voucherType: 'SALES', partyType: 'CUSTOMER', label: 'Sales invoice', partySide: 'DR' },
  PURCHASE_BILL: { voucherType: 'PURCHASE', partyType: 'SUPPLIER', label: 'Purchase bill', partySide: 'CR' },
  CREDIT_NOTE: { voucherType: 'CREDIT_NOTE', partyType: 'CUSTOMER', label: 'Credit note', partySide: 'CR' },
  DEBIT_NOTE: { voucherType: 'DEBIT_NOTE', partyType: 'SUPPLIER', label: 'Debit note', partySide: 'DR' },
};

/** Invoices and bills are settled by payments; credit / debit notes are applied against them. */
export const SETTLEABLE: DocType[] = ['SALES_INVOICE', 'PURCHASE_BILL'];
export const isSettleable = (t: DocType) => SETTLEABLE.includes(t);

// ----------------------------------------------------------------- calculation
export interface CalcLineIn {
  qty: Decimal;
  rate: Decimal;
  discountPct: Decimal;
  gstRate: Decimal;
}
export interface CalcLine {
  gross: Decimal;
  discount: Decimal;
  taxable: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  igst: Decimal;
  total: Decimal;
}

/** Pure, deterministic GST maths shared by the API (and mirrored by the UI preview). */
export function calcLine(l: CalcLineIn, interState: boolean, gstEnabled: boolean): CalcLine {
  const gross = r2(l.qty.times(l.rate));
  const discount = r2(gross.times(l.discountPct).div(100));
  const taxable = gross.minus(discount);
  const rate = gstEnabled ? l.gstRate : ZERO;
  let cgst = ZERO, sgst = ZERO, igst = ZERO;
  if (interState) igst = r2(taxable.times(rate).div(100));
  else {
    cgst = r2(taxable.times(rate).div(200));
    sgst = cgst;
  }
  return { gross, discount, taxable, cgst, sgst, igst, total: taxable.plus(cgst).plus(sgst).plus(igst) };
}

export function calcTotals(lines: CalcLine[], roundToRupee: boolean) {
  const sum = (f: (l: CalcLine) => Decimal) => lines.reduce((a, l) => a.plus(f(l)), ZERO);
  const raw = sum((l) => l.total);
  const total = roundToRupee ? raw.toDecimalPlaces(0, Decimal.ROUND_HALF_UP) : raw;
  return {
    subtotal: sum((l) => l.gross),
    discountTotal: sum((l) => l.discount),
    taxableTotal: sum((l) => l.taxable),
    cgstTotal: sum((l) => l.cgst),
    sgstTotal: sum((l) => l.sgst),
    igstTotal: sum((l) => l.igst),
    roundOff: total.minus(raw),
    total,
  };
}

// ----------------------------------------------------------------------- input
export interface DocLineInput {
  productId?: string | undefined;
  ledgerId?: string | undefined;
  description?: string | undefined;
  hsn?: string | undefined;
  unit?: string | undefined;
  qty: string | number;
  rate?: string | number | undefined;
  discountPct?: string | number | undefined;
  gstRate?: string | number | undefined;
}
export interface DocumentInput {
  type: DocType;
  date: string;
  dueDate?: string | undefined;
  partyId: string;
  reference?: string | undefined;
  placeOfSupplyCode?: string | undefined;
  notes?: string | undefined;
  terms?: string | undefined;
  originalDocumentId?: string | undefined;
  /** For credit / debit notes: immediately apply the note against these invoices / bills. */
  applyTo?: { documentId: string; amount: string | number }[] | undefined;
  lines: DocLineInput[];
}

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

/** Outstanding (unsettled) amount for each document id: total less everything allocated against it. */
export async function outstandingMap(db: Tx | typeof prisma, docs: { id: string; type: DocType; total: Prisma.Decimal | Decimal; status?: string }[]) {
  const ids = docs.map((d) => d.id);
  const out = new Map<string, Decimal>();
  if (!ids.length) return out;
  const [asTarget, asCredit] = await Promise.all([
    db.allocation.groupBy({ by: ['documentId'], where: { documentId: { in: ids } }, _sum: { amount: true } }),
    db.allocation.groupBy({ by: ['creditDocumentId'], where: { creditDocumentId: { in: ids } }, _sum: { amount: true } }),
  ]);
  const tgt = new Map(asTarget.map((r) => [r.documentId, D(r._sum.amount)]));
  const crd = new Map(asCredit.map((r) => [r.creditDocumentId as string, D(r._sum.amount)]));
  for (const d of docs) {
    const used = isSettleable(d.type) ? tgt.get(d.id) ?? ZERO : crd.get(d.id) ?? ZERO;
    out.set(d.id, d.status === 'CANCELLED' ? ZERO : D(d.total).minus(used));
  }
  return out;
}

// ---------------------------------------------------------------------- create
export function createDocument(actor: Actor, input: DocumentInput) {
  return prisma.$transaction((tx) => createDocumentTx(tx, actor, input), { timeout: 30000, maxWait: 10000 });
}

export async function createDocumentTx(tx: Tx, actor: Actor, input: DocumentInput) {
  const meta = DOC_META[input.type];
  const company = await tx.company.findUniqueOrThrow({ where: { id: actor.companyId } });
  const party = await tx.party.findFirst({ where: { id: input.partyId, companyId: actor.companyId } });
  if (!party) throw new AppError(422, 'INVALID_PARTY', 'Party not found');
  if (!party.isActive) throw new AppError(422, 'INACTIVE_PARTY', `${party.name} is inactive`);
  if (party.type !== meta.partyType) {
    throw new AppError(422, 'WRONG_PARTY_TYPE', `A ${meta.label.toLowerCase()} needs a ${meta.partyType.toLowerCase()}`);
  }
  if (!input.lines.length) throw new AppError(422, 'NO_LINES', 'Add at least one line item');

  const date = parseDate(input.date);
  let dueDate: Date | null = null;
  if (isSettleable(input.type)) {
    dueDate = input.dueDate ? parseDate(input.dueDate) : addDays(date, party.creditDays);
    if (dueDate < date) throw new AppError(422, 'INVALID_DUE_DATE', 'Due date cannot be before the document date');
  }

  let original: { id: string; partyId: string; type: DocType } | null = null;
  if (input.originalDocumentId) {
    original = await tx.document.findFirst({ where: { id: input.originalDocumentId, companyId: actor.companyId }, select: { id: true, partyId: true, type: true } });
    const expected: DocType | undefined = input.type === 'CREDIT_NOTE' ? 'SALES_INVOICE' : input.type === 'DEBIT_NOTE' ? 'PURCHASE_BILL' : undefined;
    if (!original || !expected || original.type !== expected || original.partyId !== party.id) {
      throw new AppError(422, 'INVALID_ORIGINAL', 'The referenced invoice / bill does not match this note');
    }
  }

  // Place of supply decides CGST+SGST (intra-state) versus IGST (inter-state).
  const posCode = input.placeOfSupplyCode || party.stateCode || company.stateCode || null;
  const interState = company.gstEnabled && !!posCode && !!company.stateCode && posCode !== company.stateCode;

  const productIds = input.lines.map((l) => l.productId).filter((x): x is string => !!x);
  const products = new Map((await tx.product.findMany({ where: { companyId: actor.companyId, id: { in: productIds } } })).map((p) => [p.id, p]));
  const ledgerIds = [...new Set(input.lines.map((l) => l.ledgerId).filter((x): x is string => !!x))];
  const overrideLedgers = new Map(
    (await tx.ledger.findMany({ where: { companyId: actor.companyId, id: { in: ledgerIds }, isActive: true }, include: { group: { select: { nature: true } } } })).map((l) => [l.id, l]),
  );

  const sales = input.type === 'SALES_INVOICE' || input.type === 'CREDIT_NOTE';
  const calcInputs = input.lines.map((l, i) => {
    const p = l.productId ? products.get(l.productId) : undefined;
    if (l.productId && !p) throw new AppError(422, 'INVALID_PRODUCT', `Line ${i + 1}: product not found`);
    if (p && !p.isActive) throw new AppError(422, 'INACTIVE_PRODUCT', `Line ${i + 1}: ${p.name} is inactive`);
    if (l.ledgerId) {
      const lg = overrideLedgers.get(l.ledgerId);
      const ok = lg && (sales ? lg.group.nature === 'INCOME' : lg.group.nature === 'EXPENSE' || lg.group.nature === 'ASSET');
      if (!ok) throw new AppError(422, 'INVALID_LEDGER', `Line ${i + 1}: choose a valid ${sales ? 'income' : 'expense or asset'} account`);
    }
    const description = (l.description?.trim() || p?.name || '').slice(0, 300);
    if (!description) throw new AppError(422, 'INVALID_LINE', `Line ${i + 1}: description or product required`);
    const qty = D(l.qty);
    if (qty.lte(0) || qty.decimalPlaces() > 3) throw new AppError(422, 'INVALID_QTY', `Line ${i + 1}: quantity must be > 0 with at most 3 decimals`);
    const rate = l.rate !== undefined ? D(l.rate) : D(sales ? p?.salePrice : p?.purchasePrice);
    if (rate.lt(0) || rate.decimalPlaces() > 2) throw new AppError(422, 'INVALID_RATE', `Line ${i + 1}: invalid rate`);
    const gstRate = l.gstRate !== undefined ? D(l.gstRate) : D(p?.gstRate);
    return {
      product: p,
      ledgerId: l.ledgerId,
      description,
      hsn: l.hsn?.trim() || p?.hsn || null,
      unit: l.unit?.trim() || p?.unit || null,
      input: { qty, rate, discountPct: D(l.discountPct), gstRate } satisfies CalcLineIn,
    };
  });
  const calcs = calcInputs.map((c) => calcLine(c.input, interState, company.gstEnabled));
  const totals = calcTotals(calcs, company.roundOffInvoices);
  if (totals.total.lte(0)) throw new AppError(422, 'ZERO_TOTAL', 'Document total must be greater than zero');

  // ---- stock positions
  const stockProductIds = calcInputs.filter((c) => c.product && c.product.kind === 'GOODS' && c.product.trackStock).map((c) => c.product!.id);
  const stock = await lockProducts(tx, actor.companyId, stockProductIds);
  const outgoing = input.type === 'SALES_INVOICE' || input.type === 'DEBIT_NOTE';
  const moves: { state: StockState; type: StockMoveType; qty: Decimal; value: Decimal; lineIdx: number }[] = [];
  const costs: Decimal[] = calcInputs.map(() => ZERO);
  calcInputs.forEach((c, i) => {
    const state = c.product ? stock.get(c.product.id) : undefined;
    if (!state || !state.trackStock) return;
    const qty = c.input.qty;
    const taxable = calcs[i]!.taxable;
    if (outgoing) assertAvailable(state, qty, company.allowNegativeStock);
    let value: Decimal;
    let type: StockMoveType;
    switch (input.type) {
      case 'SALES_INVOICE': value = outValue(state, qty); type = 'SALE'; break;
      case 'DEBIT_NOTE': value = taxable; type = 'PURCHASE_RETURN'; break;
      case 'PURCHASE_BILL': value = taxable; type = 'PURCHASE'; break;
      default: value = inValueAtAverage(state, qty); type = 'SALE_RETURN'; break; // CREDIT_NOTE
    }
    // Apply to the in-memory state immediately so repeated lines for one product see the running position.
    const signedQty = outgoing ? qty.neg() : qty;
    const signedValue = outgoing ? value.neg() : value;
    state.qty = state.qty.plus(signedQty);
    state.value = state.value.plus(signedValue);
    moves.push({ state, type, qty: signedQty, value: signedValue, lineIdx: i });
    costs[i] = value;
  });

  // ---- ledger postings
  const keys = ['SALES', 'SALES_RETURNS', 'PURCHASES', 'PURCHASE_RETURNS', 'INVENTORY', 'COGS', 'ROUND_OFF', 'OUTPUT_CGST', 'OUTPUT_SGST', 'OUTPUT_IGST', 'INPUT_CGST', 'INPUT_SGST', 'INPUT_IGST'] as const;
  const sys = await systemLedgers(tx, actor.companyId, [...keys]);
  const partyKey = meta.partySide;
  const other: EntrySide = partyKey === 'DR' ? 'CR' : 'DR';
  const acc = new Map<string, { ledgerId: string; side: EntrySide; amount: Decimal }>();
  const add = (ledgerId: string, side: EntrySide, amount: Decimal) => {
    if (amount.lte(0)) return;
    const k = `${ledgerId}|${side}`;
    const cur = acc.get(k);
    if (cur) cur.amount = cur.amount.plus(amount);
    else acc.set(k, { ledgerId, side, amount });
  };

  add(party.ledgerId, partyKey, totals.total);
  calcInputs.forEach((c, i) => {
    const taxable = calcs[i]!.taxable;
    const isStock = c.product && c.product.kind === 'GOODS' && c.product.trackStock;
    let target: string;
    if (c.ledgerId) target = c.ledgerId;
    else if (input.type === 'SALES_INVOICE') target = sys.SALES;
    else if (input.type === 'CREDIT_NOTE') target = sys.SALES_RETURNS;
    else if (isStock) target = sys.INVENTORY;
    else target = input.type === 'PURCHASE_BILL' ? sys.PURCHASES : sys.PURCHASE_RETURNS;
    add(target, other, taxable);
  });
  const purchaseSide = input.type === 'PURCHASE_BILL' || input.type === 'DEBIT_NOTE';
  add(purchaseSide ? sys.INPUT_CGST : sys.OUTPUT_CGST, other, totals.cgstTotal);
  add(purchaseSide ? sys.INPUT_SGST : sys.OUTPUT_SGST, other, totals.sgstTotal);
  add(purchaseSide ? sys.INPUT_IGST : sys.OUTPUT_IGST, other, totals.igstTotal);
  // Round-off: the party carries the rounded total, everything else carries the raw sum.
  if (totals.roundOff.gt(0)) add(sys.ROUND_OFF, other, totals.roundOff);
  else if (totals.roundOff.lt(0)) add(sys.ROUND_OFF, partyKey, totals.roundOff.abs());
  // Inventory <-> cost of goods sold for stock-tracked sales and sales returns.
  const stockCost = costs.reduce((a, c) => a.plus(c), ZERO);
  if (input.type === 'SALES_INVOICE') {
    add(sys.COGS, 'DR', stockCost);
    add(sys.INVENTORY, 'CR', stockCost);
  } else if (input.type === 'CREDIT_NOTE') {
    add(sys.INVENTORY, 'DR', stockCost);
    add(sys.COGS, 'CR', stockCost);
  }

  const lines: LineInput[] = [...acc.values()].map((a) => ({ ledgerId: a.ledgerId, side: a.side, amount: a.amount.toFixed(2) }));
  lines.sort((a, b) => (a.side === b.side ? 0 : a.side === 'DR' ? -1 : 1));
  const voucher = await postVoucherTx(tx, actor, {
    type: meta.voucherType,
    date: input.date,
    reference: input.reference,
    source: 'INVOICE',
    narration: `${meta.label} - ${party.name}${input.reference ? ` (${input.reference})` : ''}`,
    lines,
  });

  const doc = await tx.document.create({
    data: {
      companyId: actor.companyId,
      type: input.type,
      number: voucher.number,
      date,
      dueDate,
      partyId: party.id,
      voucherId: voucher.id,
      reference: input.reference?.trim() || null,
      placeOfSupply: posCode ? (await stateName(posCode)) ?? party.state ?? null : null,
      placeOfSupplyCode: posCode,
      isInterState: interState,
      subtotal: f2(totals.subtotal),
      discountTotal: f2(totals.discountTotal),
      taxableTotal: f2(totals.taxableTotal),
      cgstTotal: f2(totals.cgstTotal),
      sgstTotal: f2(totals.sgstTotal),
      igstTotal: f2(totals.igstTotal),
      roundOff: f2(totals.roundOff),
      total: f2(totals.total),
      notes: input.notes?.trim() || null,
      terms: input.terms?.trim() || (isSettleable(input.type) ? company.invoiceTerms : null),
      originalDocumentId: original?.id ?? null,
      createdById: actor.userId,
      lines: {
        create: calcInputs.map((c, i) => ({
          lineNo: i + 1,
          productId: c.product?.id ?? null,
          ledgerId: c.ledgerId ?? null,
          description: c.description,
          hsn: c.hsn,
          unit: c.unit,
          qty: c.input.qty.toFixed(3),
          rate: c.input.rate.toFixed(2),
          discountPct: c.input.discountPct.toFixed(2),
          discountAmount: calcs[i]!.discount.toFixed(2),
          taxableAmount: calcs[i]!.taxable.toFixed(2),
          gstRate: company.gstEnabled ? c.input.gstRate.toFixed(2) : '0.00',
          cgstAmount: calcs[i]!.cgst.toFixed(2),
          sgstAmount: calcs[i]!.sgst.toFixed(2),
          igstAmount: calcs[i]!.igst.toFixed(2),
          lineTotal: calcs[i]!.total.toFixed(2),
          costAmount: costs[i]!.toFixed(2),
        })),
      },
    },
  });

  // Persist stock movements with their running balances (replay on a fresh copy of the pre-document state).
  const replay = await lockProducts(tx, actor.companyId, moves.map((m) => m.state.id));
  for (const m of moves) {
    const st = replay.get(m.state.id)!;
    await recordMovement(tx, actor, st, { date, type: m.type, qty: m.qty, value: m.value, documentId: doc.id, voucherId: voucher.id });
  }

  if (input.applyTo?.length) {
    if (isSettleable(input.type)) throw new AppError(422, 'INVALID_APPLY', 'Only credit / debit notes can be applied against invoices');
    await applyNoteTx(tx, actor, doc.id, input.applyTo);
  }

  await tx.auditLog.create({
    data: { companyId: actor.companyId, userId: actor.userId, action: 'DOCUMENT_CREATED', entity: 'Document', entityId: doc.id, data: { type: input.type, number: doc.number, party: party.name, total: f2(totals.total) } },
  });
  return { ...doc, voucherNumber: voucher.number };
}

async function stateName(code: string) {
  const { INDIAN_STATES } = await import('../../lib/defaults');
  return INDIAN_STATES.find(([c]) => c === code)?.[1];
}

// ---------------------------------------------------------------------- cancel
export function cancelDocument(actor: Actor, id: string, reason?: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Document" WHERE "id" = ${id} AND "companyId" = ${actor.companyId} FOR UPDATE`;
    const doc = await tx.document.findFirst({ where: { id, companyId: actor.companyId }, include: { movements: true } });
    if (!doc) throw notFound('Document');
    if (doc.status === 'CANCELLED') throw new AppError(409, 'ALREADY_CANCELLED', `${doc.number} is already cancelled`);
    const used = await tx.allocation.count({ where: { OR: [{ documentId: id }, { creditDocumentId: id }] } });
    if (used) throw new AppError(409, 'HAS_ALLOCATIONS', 'Remove the payments / credit notes applied to this document before cancelling it');
    const linked = await tx.document.count({ where: { originalDocumentId: id, status: 'ACTIVE' } });
    if (linked) throw new AppError(409, 'HAS_LINKED_NOTES', 'Cancel the credit / debit notes issued against this document first');

    await reverseVoucherTx(tx, actor, doc.voucherId, { reason: reason ?? `Cancelled ${doc.number}` });
    if (doc.movements.length) {
      const states = await lockProducts(tx, actor.companyId, doc.movements.map((m) => m.productId));
      const company = await tx.company.findUniqueOrThrow({ where: { id: actor.companyId }, select: { allowNegativeStock: true } });
      for (const m of doc.movements) {
        const st = states.get(m.productId)!;
        const qty = D(m.qty).neg();
        if (qty.lt(0)) assertAvailable(st, qty.abs(), company.allowNegativeStock);
        await recordMovement(tx, actor, st, {
          date: m.date,
          type: qty.gt(0) ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
          qty,
          value: D(m.value).neg(),
          documentId: doc.id,
          voucherId: doc.voucherId,
          note: `Cancelled ${doc.number}`,
        });
      }
    }
    const updated = await tx.document.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason ?? null } });
    await tx.auditLog.create({
      data: { companyId: actor.companyId, userId: actor.userId, action: 'DOCUMENT_CANCELLED', entity: 'Document', entityId: id, data: { number: doc.number, reason: reason ?? null } },
    });
    return updated;
  }, { timeout: 30000 });
}

// ------------------------------------------------------------------ allocation
/** Allocate part of a payment or a credit/debit note to invoices / bills. All checks are done under row locks. */
export async function allocateTx(
  tx: Tx,
  actor: Actor,
  source: { paymentId: string } | { creditDocumentId: string },
  items: { documentId: string; amount: string | number }[],
) {
  const amounts = items.map((i) => ({ documentId: i.documentId, amount: D(i.amount) }));
  if (amounts.some((a) => a.amount.lte(0) || a.amount.decimalPlaces() > 2)) throw new AppError(422, 'INVALID_AMOUNT', 'Allocation amounts must be positive with at most 2 decimals');
  const total = amounts.reduce((a, i) => a.plus(i.amount), ZERO);
  const ids = [...new Set([...amounts.map((a) => a.documentId), ...('creditDocumentId' in source ? [source.creditDocumentId] : [])])].sort();
  await tx.$queryRaw`SELECT "id" FROM "Document" WHERE "companyId" = ${actor.companyId} AND "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`;

  let partyId: string;
  let available: Decimal;
  let expectType: DocType;
  if ('paymentId' in source) {
    await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${source.paymentId} AND "companyId" = ${actor.companyId} FOR UPDATE`;
    const p = await tx.payment.findFirst({ where: { id: source.paymentId, companyId: actor.companyId } });
    if (!p || p.status !== 'ACTIVE') throw new AppError(422, 'INVALID_PAYMENT', 'Payment not found or cancelled');
    partyId = p.partyId;
    expectType = p.direction === 'RECEIVED' ? 'SALES_INVOICE' : 'PURCHASE_BILL';
    const used = await tx.allocation.aggregate({ where: { paymentId: p.id }, _sum: { amount: true } });
    available = D(p.amount).minus(D(used._sum.amount));
  } else {
    const n = await tx.document.findFirst({ where: { id: source.creditDocumentId, companyId: actor.companyId } });
    if (!n || n.status !== 'ACTIVE' || isSettleable(n.type)) throw new AppError(422, 'INVALID_NOTE', 'Credit / debit note not found');
    partyId = n.partyId;
    expectType = n.type === 'CREDIT_NOTE' ? 'SALES_INVOICE' : 'PURCHASE_BILL';
    const used = await tx.allocation.aggregate({ where: { creditDocumentId: n.id }, _sum: { amount: true } });
    available = D(n.total).minus(D(used._sum.amount));
  }
  if (total.gt(available)) throw new AppError(422, 'OVER_ALLOCATED', `Allocating ${f2(total)} but only ${f2(available)} is available`);

  const docs = await tx.document.findMany({ where: { companyId: actor.companyId, id: { in: amounts.map((a) => a.documentId) } } });
  const outstanding = await outstandingMap(tx, docs);
  for (const a of amounts) {
    const d = docs.find((x) => x.id === a.documentId);
    if (!d || d.status !== 'ACTIVE' || d.type !== expectType || d.partyId !== partyId) {
      throw new AppError(422, 'INVALID_DOCUMENT', 'One of the selected documents cannot be settled by this payment / note');
    }
    if (a.amount.gt(outstanding.get(d.id) ?? ZERO)) {
      throw new AppError(422, 'OVER_ALLOCATED', `${d.number}: only ${f2(outstanding.get(d.id))} is outstanding`);
    }
    outstanding.set(d.id, outstanding.get(d.id)!.minus(a.amount));
  }
  for (const a of amounts) {
    await tx.allocation.create({
      data: { companyId: actor.companyId, documentId: a.documentId, amount: a.amount.toFixed(2), ...('paymentId' in source ? { paymentId: source.paymentId } : { creditDocumentId: source.creditDocumentId }) },
    });
  }
}

export const applyNoteTx = (tx: Tx, actor: Actor, noteId: string, items: { documentId: string; amount: string | number }[]) =>
  allocateTx(tx, actor, { creditDocumentId: noteId }, items);

// ----------------------------------------------------------------------- reads
export function paymentStatusOf(total: Decimal, outstanding: Decimal, status: string) {
  if (status === 'CANCELLED') return 'CANCELLED';
  if (outstanding.lte(0)) return 'PAID';
  if (outstanding.lt(total)) return 'PARTIAL';
  return 'UNPAID';
}

export const docIso = (d: Date | null) => (d ? isoDate(d) : null);
