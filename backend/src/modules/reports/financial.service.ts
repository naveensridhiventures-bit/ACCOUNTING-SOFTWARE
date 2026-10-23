import Decimal from 'decimal.js';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { ZERO } from '../../lib/money';
import { isoDate, parseDate } from '../../lib/dates';
import { ledgerPositions, LedgerRow } from '../../lib/balances';

interface GroupRec { id: string; name: string; parentId: string | null; nature: string }

async function groupIndex(companyId: string) {
  const groups: GroupRec[] = await prisma.accountGroup.findMany({ where: { companyId }, select: { id: true, name: true, parentId: true, nature: true } });
  const byId = new Map(groups.map((g) => [g.id, g]));
  const rootOf = (id: string): GroupRec => {
    let g = byId.get(id)!;
    while (g.parentId && byId.get(g.parentId)) g = byId.get(g.parentId)!;
    return g;
  };
  return { groups, byId, rootOf };
}

export async function fyFor(companyId: string, dateIso: string) {
  return prisma.financialYear.findFirst({ where: { companyId, startDate: { lte: parseDate(dateIso) }, endDate: { gte: parseDate(dateIso) } } });
}

const amt = (v: Decimal) => v.toFixed(2);

// ----------------------------------------------------------------- Profit & Loss
const PNL_SECTIONS = {
  revenue: ['Sales Accounts', 'Direct Incomes'],
  costOfSales: ['Purchase Accounts', 'Direct Expenses'],
  otherIncome: ['Indirect Incomes'],
  expenses: ['Indirect Expenses'],
} as const;

export async function profitAndLoss(companyId: string, from: string, to: string) {
  parseDate(from); parseDate(to);
  if (from > to) throw new AppError(400, 'INVALID_RANGE', '"from" must not be after "to"');
  const [rows, { rootOf }] = await Promise.all([ledgerPositions(companyId, from, to, { excludeSources: ['CLOSING'] }), groupIndex(companyId)]);
  const section = (names: readonly string[], income: boolean) => {
    const ledgers = rows
      .filter((r) => names.includes(rootOf(r.groupId).name))
      .map((r) => ({ ledgerId: r.id, name: r.name, group: r.groupName, amount: income ? r.credit.minus(r.debit) : r.debit.minus(r.credit) }))
      .filter((l) => !l.amount.isZero());
    const total = ledgers.reduce((a, l) => a.plus(l.amount), ZERO);
    return { ledgers: ledgers.map((l) => ({ ...l, amount: amt(l.amount) })), total, totalStr: amt(total) };
  };
  const revenue = section(PNL_SECTIONS.revenue, true);
  const cost = section(PNL_SECTIONS.costOfSales, false);
  const other = section(PNL_SECTIONS.otherIncome, true);
  const exp = section(PNL_SECTIONS.expenses, false);
  const gross = revenue.total.minus(cost.total);
  const net = gross.plus(other.total).minus(exp.total);
  const pct = (n: Decimal) => (revenue.total.isZero() ? null : n.div(revenue.total).times(100).toFixed(1));
  return {
    from, to,
    revenue: { ledgers: revenue.ledgers, total: revenue.totalStr },
    costOfSales: { ledgers: cost.ledgers, total: cost.totalStr },
    grossProfit: amt(gross),
    grossMarginPct: pct(gross),
    otherIncome: { ledgers: other.ledgers, total: other.totalStr },
    expenses: { ledgers: exp.ledgers, total: exp.totalStr },
    netProfit: amt(net),
    netMarginPct: pct(net),
  };
}

// ----------------------------------------------------------------- Balance sheet
interface Node { id: string; name: string; amount: string; ledgers: { id: string; name: string; amount: string }[]; children: Node[] }

export async function balanceSheet(companyId: string, asOf: string) {
  parseDate(asOf);
  // Using the day after `asOf` as "from" puts every voucher up to and including asOf into `pre`.
  const next = isoDate(new Date(parseDate(asOf).getTime() + 86400000));
  const [rows, { groups }] = await Promise.all([ledgerPositions(companyId, next, asOf), groupIndex(companyId)]);
  const balance = (r: LedgerRow) => r.opening.plus(r.pre);

  const nominal = rows.filter((r) => r.nature === 'INCOME' || r.nature === 'EXPENSE');
  const profit = nominal.reduce((a, r) => a.minus(balance(r)), ZERO); // credit-nature balances are negative => profit positive

  const build = (nature: 'ASSET' | 'LIABILITY') => {
    const sign = nature === 'ASSET' ? 1 : -1;
    const nodes = new Map<string, Node & { _sum: Decimal }>();
    for (const g of groups.filter((g) => g.nature === nature)) nodes.set(g.id, { id: g.id, name: g.name, amount: '0.00', ledgers: [], children: [], _sum: ZERO });
    for (const r of rows.filter((r) => r.nature === nature)) {
      const v = balance(r).times(sign);
      if (v.isZero()) continue;
      const n = nodes.get(r.groupId);
      if (!n) continue;
      n.ledgers.push({ id: r.id, name: r.name, amount: amt(v) });
      n._sum = n._sum.plus(v);
    }
    // roll up children into parents (deepest first)
    const depth = (id: string): number => { let d = 0; let g = groups.find((x) => x.id === id); while (g?.parentId) { d++; g = groups.find((x) => x.id === g!.parentId); } return d; };
    const ordered = [...nodes.values()].sort((a, b) => depth(b.id) - depth(a.id));
    for (const n of ordered) {
      const g = groups.find((x) => x.id === n.id)!;
      n.amount = amt(n._sum);
      if (g.parentId && nodes.has(g.parentId)) {
        const p = nodes.get(g.parentId)!;
        p._sum = p._sum.plus(n._sum);
        if (!n._sum.isZero() || n.ledgers.length) p.children.push(n);
      }
    }
    const roots = [...nodes.values()].filter((n) => !groups.find((g) => g.id === n.id)!.parentId);
    const total = roots.reduce((a, n) => a.plus(n._sum), ZERO);
    const clean = (n: Node & { _sum: Decimal }): Node => ({ id: n.id, name: n.name, amount: amt(n._sum), ledgers: n.ledgers, children: n.children.map((c) => clean(c as Node & { _sum: Decimal })).sort((a, b) => a.name.localeCompare(b.name)) });
    return { groups: roots.filter((n) => !n._sum.isZero() || n.ledgers.length).map(clean), total };
  };

  const assets = build('ASSET');
  const liabilities = build('LIABILITY');
  const rightTotal = liabilities.total.plus(profit);
  const diff = assets.total.minus(rightTotal);
  return {
    asOf,
    assets: { groups: assets.groups, total: amt(assets.total) },
    liabilities: { groups: liabilities.groups, total: amt(liabilities.total) },
    profitAndLoss: amt(profit),
    // Non-zero only if opening balances were entered one-sided; shown as a balancing line like Tally does.
    differenceInOpeningBalances: amt(diff),
    totalLiabilitiesAndEquity: amt(rightTotal.plus(diff)),
    totalAssets: amt(assets.total),
    isBalanced: diff.isZero(),
  };
}

// ------------------------------------------------------------- Group / TB summary
export async function groupSummary(companyId: string, from: string, to: string) {
  const [rows, { groups }] = await Promise.all([ledgerPositions(companyId, from, to), groupIndex(companyId)]);
  return {
    from, to,
    groups: groups.map((g) => {
      const members = rows.filter((r) => r.groupId === g.id);
      const debit = members.reduce((a, r) => a.plus(r.debit), ZERO);
      const credit = members.reduce((a, r) => a.plus(r.credit), ZERO);
      const closing = members.reduce((a, r) => a.plus(r.opening).plus(r.pre).plus(r.debit).minus(r.credit), ZERO);
      return { id: g.id, name: g.name, parentId: g.parentId, nature: g.nature, debit: amt(debit), credit: amt(credit), closing: amt(closing.abs()), closingSide: closing.gte(0) ? 'DR' : 'CR' };
    }),
  };
}

// ------------------------------------------------------------------ Year closing
export async function closingEntries(companyId: string, fyId: string) {
  const fy = await prisma.financialYear.findFirst({ where: { id: fyId, companyId } });
  if (!fy) throw new AppError(404, 'NOT_FOUND', 'Financial year not found');
  const rows = await ledgerPositions(companyId, isoDate(fy.startDate), isoDate(fy.endDate), { excludeSources: ['CLOSING'] });
  const nominal = rows.filter((r) => r.nature === 'INCOME' || r.nature === 'EXPENSE');
  const entries = nominal.map((r) => ({ ledgerId: r.id, name: r.name, net: r.debit.minus(r.credit) })).filter((e) => !e.net.isZero());
  const netProfit = entries.reduce((a, e) => a.minus(e.net), ZERO);
  return { fy, entries, netProfit };
}
