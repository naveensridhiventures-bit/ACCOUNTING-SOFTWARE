import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { D, ZERO } from '../../lib/money';
import { isoDate, parseDate, todayIso } from '../../lib/dates';
import { cashBankLedgerIds } from '../../lib/systemLedgers';
import { ledgerBalances } from '../../lib/balances';
import { fyFor, profitAndLoss } from './financial.service';
import { ageing } from './receivables.service';

function monthsBack(today: string, n: number) {
  const d = parseDate(today);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(m.toISOString().slice(0, 7));
  }
  return out;
}

export async function dashboard(companyId: string) {
  const today = todayIso();
  const fy = (await fyFor(companyId, today)) ?? (await prisma.financialYear.findFirst({ where: { companyId }, orderBy: { startDate: 'desc' } }));
  const fyStart = fy ? isoDate(fy.startDate) : today.slice(0, 4) + '-01-01';
  const months = monthsBack(today, 12);
  const seriesFrom = months[0]! + '-01';

  const cbIds = await cashBankLedgerIds(prisma, companyId);
  const [balances, cbLedgers, pnl, recv, pay, monthly, cashflow, topCustomers, lowStock, recent, counts] = await Promise.all([
    ledgerBalances(companyId, today, cbIds),
    prisma.ledger.findMany({ where: { id: { in: cbIds }, isActive: true }, select: { id: true, name: true, group: { select: { name: true } } }, orderBy: { name: 'asc' } }),
    profitAndLoss(companyId, fyStart, today),
    ageing(companyId, 'RECEIVABLES', today),
    ageing(companyId, 'PAYABLES', today),
    prisma.$queryRaw<{ m: string; income: Prisma.Decimal; expense: Prisma.Decimal }[]>`
      SELECT to_char(date_trunc('month', v."date"), 'YYYY-MM') AS m,
        COALESCE(SUM(CASE WHEN g."nature" = 'INCOME' THEN (CASE WHEN vl."side" = 'CR' THEN vl."amount" ELSE -vl."amount" END) ELSE 0 END), 0) AS income,
        COALESCE(SUM(CASE WHEN g."nature" = 'EXPENSE' THEN (CASE WHEN vl."side" = 'DR' THEN vl."amount" ELSE -vl."amount" END) ELSE 0 END), 0) AS expense
      FROM "VoucherLine" vl JOIN "Voucher" v ON v."id" = vl."voucherId" JOIN "Ledger" l ON l."id" = vl."ledgerId" JOIN "AccountGroup" g ON g."id" = l."groupId"
      WHERE v."companyId" = ${companyId} AND v."date" >= ${seriesFrom}::date AND v."date" <= ${today}::date AND COALESCE(v."source", '') <> 'CLOSING'
      GROUP BY 1 ORDER BY 1`,
    cbIds.length
      ? prisma.$queryRaw<{ m: string; inflow: Prisma.Decimal; outflow: Prisma.Decimal }[]>`
      SELECT to_char(date_trunc('month', v."date"), 'YYYY-MM') AS m,
        COALESCE(SUM(vl."amount") FILTER (WHERE vl."side" = 'DR'), 0) AS inflow, COALESCE(SUM(vl."amount") FILTER (WHERE vl."side" = 'CR'), 0) AS outflow
      FROM "VoucherLine" vl JOIN "Voucher" v ON v."id" = vl."voucherId"
      WHERE v."companyId" = ${companyId} AND vl."ledgerId" IN (${Prisma.join(cbIds)}) AND v."type" <> 'CONTRA' AND v."date" >= ${seriesFrom}::date AND v."date" <= ${today}::date
      GROUP BY 1 ORDER BY 1`
      : Promise.resolve([]),
    prisma.$queryRaw<{ id: string; name: string; sales: Prisma.Decimal }[]>`
      SELECT p."id", p."name", SUM(CASE WHEN d."type" = 'CREDIT_NOTE' THEN -d."taxableTotal" ELSE d."taxableTotal" END) AS sales
      FROM "Document" d JOIN "Party" p ON p."id" = d."partyId"
      WHERE d."companyId" = ${companyId} AND d."status" = 'ACTIVE' AND d."type" IN ('SALES_INVOICE', 'CREDIT_NOTE') AND d."date" >= ${fyStart}::date AND d."date" <= ${today}::date
      GROUP BY p."id" ORDER BY sales DESC LIMIT 5`,
    prisma.$queryRaw<{ id: string; sku: string; name: string; qty: Prisma.Decimal; reorder: Prisma.Decimal; unit: string }[]>`
      SELECT "id", "sku", "name", "onHandQty" AS qty, "reorderLevel" AS reorder, "unit" FROM "Product"
      WHERE "companyId" = ${companyId} AND "trackStock" AND "kind" = 'GOODS' AND "isActive" AND "onHandQty" <= "reorderLevel" ORDER BY "onHandQty" ASC LIMIT 8`,
    prisma.voucher.findMany({ where: { companyId }, orderBy: [{ createdAt: 'desc' }], take: 8, select: { id: true, number: true, type: true, date: true, narration: true, totalAmount: true, status: true } }),
    Promise.all([
      prisma.document.count({ where: { companyId, type: 'SALES_INVOICE', status: 'ACTIVE' } }),
      prisma.party.count({ where: { companyId, type: 'CUSTOMER', isActive: true } }),
      prisma.party.count({ where: { companyId, type: 'SUPPLIER', isActive: true } }),
      prisma.product.count({ where: { companyId, isActive: true } }),
    ]),
  ]);

  const overdue = (r: typeof recv) => D(r.totals.d1_30).plus(r.totals.d31_60).plus(r.totals.d61_90).plus(r.totals.d90plus);
  const byMonth = new Map(monthly.map((r) => [r.m, r]));
  const cfMonth = new Map(cashflow.map((r) => [r.m, r]));
  const bank = cbLedgers.map((l) => ({ id: l.id, name: l.name, group: l.group.name, balance: (balances.get(l.id) ?? ZERO).toFixed(2) }));
  const cashTotal = bank.reduce((a, b) => a.plus(D(b.balance)), ZERO);

  return {
    asOf: today,
    financialYear: fy ? { id: fy.id, name: fy.name, start: fyStart, end: isoDate(fy.endDate), isClosed: fy.isClosed } : null,
    kpis: {
      cashAndBank: cashTotal.toFixed(2),
      receivables: recv.totals.outstanding,
      receivablesOverdue: overdue(recv).toFixed(2),
      payables: pay.totals.outstanding,
      payablesOverdue: overdue(pay).toFixed(2),
      revenue: pnl.revenue.total,
      expenses: D(pnl.costOfSales.total).plus(pnl.expenses.total).toFixed(2),
      grossProfit: pnl.grossProfit,
      netProfit: pnl.netProfit,
    },
    accounts: bank,
    monthly: months.map((m) => {
      const r = byMonth.get(m), c = cfMonth.get(m);
      const income = D(r?.income), expense = D(r?.expense);
      return { month: m, income: income.toFixed(2), expense: expense.toFixed(2), profit: income.minus(expense).toFixed(2), cashIn: D(c?.inflow).toFixed(2), cashOut: D(c?.outflow).toFixed(2) };
    }),
    topCustomers: topCustomers.map((c) => ({ id: c.id, name: c.name, sales: D(c.sales).toFixed(2) })),
    topOverdue: recv.rows.filter((r) => D(r.d1_30).plus(r.d31_60).plus(r.d61_90).plus(r.d90plus).gt(0)).slice(0, 5).map((r) => ({ partyId: r.partyId, party: r.party, overdue: D(r.d1_30).plus(r.d31_60).plus(r.d61_90).plus(r.d90plus).toFixed(2) })),
    lowStock: lowStock.map((p) => ({ id: p.id, sku: p.sku, name: p.name, qty: D(p.qty).toFixed(3), reorderLevel: D(p.reorder).toFixed(3), unit: p.unit })),
    recentVouchers: recent.map((v) => ({ id: v.id, number: v.number, type: v.type, date: isoDate(v.date), narration: v.narration, amount: D(v.totalAmount).toFixed(2), status: v.status })),
    counts: { invoices: counts[0], customers: counts[1], suppliers: counts[2], products: counts[3] },
  };
}

export async function partySummary(companyId: string, kind: 'SALES' | 'PURCHASE', from: string, to: string) {
  const types = kind === 'SALES' ? ['SALES_INVOICE', 'CREDIT_NOTE'] : ['PURCHASE_BILL', 'DEBIT_NOTE'];
  const rows = await prisma.$queryRaw<{ id: string; name: string; gstin: string | null; docs: bigint; taxable: Prisma.Decimal; tax: Prisma.Decimal; total: Prisma.Decimal }[]>`
    SELECT p."id", p."name", p."gstin", COUNT(*) AS docs,
      SUM(CASE WHEN d."type" IN ('CREDIT_NOTE', 'DEBIT_NOTE') THEN -d."taxableTotal" ELSE d."taxableTotal" END) AS taxable,
      SUM(CASE WHEN d."type" IN ('CREDIT_NOTE', 'DEBIT_NOTE') THEN -(d."cgstTotal" + d."sgstTotal" + d."igstTotal") ELSE (d."cgstTotal" + d."sgstTotal" + d."igstTotal") END) AS tax,
      SUM(CASE WHEN d."type" IN ('CREDIT_NOTE', 'DEBIT_NOTE') THEN -d."total" ELSE d."total" END) AS total
    FROM "Document" d JOIN "Party" p ON p."id" = d."partyId"
    WHERE d."companyId" = ${companyId} AND d."status" = 'ACTIVE' AND d."type"::text IN (${Prisma.join(types)}) AND d."date" >= ${from}::date AND d."date" <= ${to}::date
    GROUP BY p."id" ORDER BY total DESC`;
  return { from, to, kind, rows: rows.map((r) => ({ partyId: r.id, party: r.name, gstin: r.gstin, documents: Number(r.docs), taxable: D(r.taxable).toFixed(2), tax: D(r.tax).toFixed(2), total: D(r.total).toFixed(2) })) };
}

export async function productSummary(companyId: string, kind: 'SALES' | 'PURCHASE', from: string, to: string) {
  const types = kind === 'SALES' ? ['SALES_INVOICE', 'CREDIT_NOTE'] : ['PURCHASE_BILL', 'DEBIT_NOTE'];
  const rows = await prisma.$queryRaw<{ id: string | null; name: string; unit: string | null; qty: Prisma.Decimal; taxable: Prisma.Decimal; cost: Prisma.Decimal }[]>`
    SELECT pr."id", COALESCE(pr."name", dl."description") AS name, MAX(dl."unit") AS unit,
      SUM(CASE WHEN d."type" IN ('CREDIT_NOTE', 'DEBIT_NOTE') THEN -dl."qty" ELSE dl."qty" END) AS qty,
      SUM(CASE WHEN d."type" IN ('CREDIT_NOTE', 'DEBIT_NOTE') THEN -dl."taxableAmount" ELSE dl."taxableAmount" END) AS taxable,
      SUM(CASE WHEN d."type" = 'SALES_INVOICE' THEN dl."costAmount" WHEN d."type" = 'CREDIT_NOTE' THEN -dl."costAmount" ELSE 0 END) AS cost
    FROM "DocumentLine" dl JOIN "Document" d ON d."id" = dl."documentId" LEFT JOIN "Product" pr ON pr."id" = dl."productId"
    WHERE d."companyId" = ${companyId} AND d."status" = 'ACTIVE' AND d."type"::text IN (${Prisma.join(types)}) AND d."date" >= ${from}::date AND d."date" <= ${to}::date
    GROUP BY pr."id", COALESCE(pr."name", dl."description") ORDER BY taxable DESC`;
  return {
    from, to, kind,
    rows: rows.map((r) => {
      const taxable = D(r.taxable), cost = D(r.cost);
      return { productId: r.id, name: r.name, unit: r.unit, qty: D(r.qty).toFixed(3), taxable: taxable.toFixed(2), ...(kind === 'SALES' && { cost: cost.toFixed(2), margin: taxable.minus(cost).toFixed(2), marginPct: taxable.isZero() ? null : taxable.minus(cost).div(taxable).times(100).toFixed(1) }) };
    }),
  };
}
