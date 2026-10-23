import Decimal from 'decimal.js';
import { prisma } from '../../lib/prisma';
import { D, ZERO } from '../../lib/money';
import { isoDate, parseDate } from '../../lib/dates';
import { outstandingMap } from '../sales/documents.service';

const BUCKETS = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90plus'] as const;
type Bucket = (typeof BUCKETS)[number];
const bucketOf = (daysOverdue: number): Bucket => (daysOverdue <= 0 ? 'current' : daysOverdue <= 30 ? 'd1_30' : daysOverdue <= 60 ? 'd31_60' : daysOverdue <= 90 ? 'd61_90' : 'd90plus');
const daysBetween = (a: string, b: string) => Math.round((parseDate(a).getTime() - parseDate(b).getTime()) / 86400000);

/** Ageing of open invoices (receivables) or bills (payables) as at a date, by due date. */
export async function ageing(companyId: string, kind: 'RECEIVABLES' | 'PAYABLES', asOf: string) {
  const type = kind === 'RECEIVABLES' ? 'SALES_INVOICE' : 'PURCHASE_BILL';
  const noteType = kind === 'RECEIVABLES' ? 'CREDIT_NOTE' : 'DEBIT_NOTE';
  const docs = await prisma.document.findMany({
    where: { companyId, type: { in: [type, noteType] }, status: 'ACTIVE', date: { lte: parseDate(asOf) } },
    include: { party: { select: { id: true, name: true, phone: true, creditDays: true } } },
    orderBy: { date: 'asc' },
  });
  // Allocations dated after asOf are ignored only approximately (allocations are not date-stamped to the payment date);
  // for ageing "as at today" this is exact.
  const out = await outstandingMap(prisma, docs);

  const parties = new Map<string, { partyId: string; party: string; phone: string | null; buckets: Record<Bucket, Decimal>; outstanding: Decimal; unapplied: Decimal; invoices: { id: string; number: string; date: string; dueDate: string | null; daysOverdue: number; total: string; balance: string }[] }>();
  const get = (p: { id: string; name: string; phone: string | null }) => {
    let e = parties.get(p.id);
    if (!e) {
      e = { partyId: p.id, party: p.name, phone: p.phone, buckets: { current: ZERO, d1_30: ZERO, d31_60: ZERO, d61_90: ZERO, d90plus: ZERO }, outstanding: ZERO, unapplied: ZERO, invoices: [] };
      parties.set(p.id, e);
    }
    return e;
  };

  for (const d of docs) {
    const bal = out.get(d.id) ?? ZERO;
    if (bal.lte(0)) continue;
    const e = get(d.party);
    if (d.type === type) {
      const due = isoDate(d.dueDate ?? d.date);
      const days = daysBetween(asOf, due);
      e.buckets[bucketOf(days)] = e.buckets[bucketOf(days)].plus(bal);
      e.outstanding = e.outstanding.plus(bal);
      e.invoices.push({ id: d.id, number: d.number, date: isoDate(d.date), dueDate: d.dueDate ? isoDate(d.dueDate) : null, daysOverdue: Math.max(0, days), total: D(d.total).toFixed(2), balance: bal.toFixed(2) });
    } else e.unapplied = e.unapplied.plus(bal);
  }
  // Unapplied (advance) payments
  const payments = await prisma.payment.findMany({
    where: { companyId, status: 'ACTIVE', direction: kind === 'RECEIVABLES' ? 'RECEIVED' : 'PAID', date: { lte: parseDate(asOf) } },
    include: { party: { select: { id: true, name: true, phone: true } } },
  });
  const used = await prisma.allocation.groupBy({ by: ['paymentId'], where: { paymentId: { in: payments.map((p) => p.id) } }, _sum: { amount: true } });
  const usedMap = new Map(used.map((u) => [u.paymentId, D(u._sum.amount)]));
  for (const p of payments) {
    const left = D(p.amount).minus(usedMap.get(p.id) ?? ZERO);
    if (left.gt(0)) get(p.party).unapplied = get(p.party).unapplied.plus(left);
  }

  const rows = [...parties.values()].sort((a, b) => b.outstanding.minus(a.outstanding).toNumber());
  const sumB = (b: Bucket) => rows.reduce((a, r) => a.plus(r.buckets[b]), ZERO);
  return {
    asOf, kind,
    rows: rows.map((r) => ({
      partyId: r.partyId, party: r.party, phone: r.phone,
      current: r.buckets.current.toFixed(2), d1_30: r.buckets.d1_30.toFixed(2), d31_60: r.buckets.d31_60.toFixed(2), d61_90: r.buckets.d61_90.toFixed(2), d90plus: r.buckets.d90plus.toFixed(2),
      outstanding: r.outstanding.toFixed(2), unapplied: r.unapplied.toFixed(2), net: r.outstanding.minus(r.unapplied).toFixed(2), invoices: r.invoices,
    })),
    totals: {
      current: sumB('current').toFixed(2), d1_30: sumB('d1_30').toFixed(2), d31_60: sumB('d31_60').toFixed(2), d61_90: sumB('d61_90').toFixed(2), d90plus: sumB('d90plus').toFixed(2),
      outstanding: rows.reduce((a, r) => a.plus(r.outstanding), ZERO).toFixed(2),
      unapplied: rows.reduce((a, r) => a.plus(r.unapplied), ZERO).toFixed(2),
    },
  };
}
