import Decimal from 'decimal.js';
import { prisma } from '../../lib/prisma';
import { AppError, notFound } from '../../lib/errors';
import { isoDate, parseDate } from '../../lib/dates';

interface TbRow {
  id: string;
  name: string;
  groupName: string;
  nature: string;
  opening: Prisma_Decimal;
  debit: Prisma_Decimal;
  credit: Prisma_Decimal;
}
type Prisma_Decimal = { toString(): string };

const d = (v: Prisma_Decimal) => new Decimal(v.toString());

/**
 * Trial balance for [from, to] inclusive.
 * Amounts are signed internally (debit positive, credit negative) and reported as Dr/Cr columns.
 * Opening = ledger opening balance + all voucher movement before `from`.
 * Note: ledger opening balances are treated as at the start of books; year-end closing of
 * P&L accounts into capital is a later phase.
 */
export async function trialBalance(companyId: string, fromIso: string | undefined, toIso: string) {
  parseDate(toIso);
  let from = fromIso;
  if (!from) {
    const fy = await prisma.financialYear.findFirst({
      where: { companyId, startDate: { lte: parseDate(toIso) }, endDate: { gte: parseDate(toIso) } },
    });
    if (!fy) throw new AppError(422, 'NO_FINANCIAL_YEAR', `No financial year covers ${toIso}`);
    from = isoDate(fy.startDate);
  }
  parseDate(from);

  const rows = await prisma.$queryRaw<TbRow[]>`
    SELECT l."id", l."name", g."name" AS "groupName", g."nature"::text AS "nature",
      (CASE WHEN l."openingSide" = 'DR' THEN l."openingBalance" ELSE -l."openingBalance" END
        + COALESCE(SUM(CASE WHEN v."date" < ${from}::date
                            THEN CASE WHEN vl."side" = 'DR' THEN vl."amount" ELSE -vl."amount" END END), 0)) AS "opening",
      COALESCE(SUM(vl."amount") FILTER (WHERE vl."side" = 'DR' AND v."date" >= ${from}::date AND v."date" <= ${toIso}::date), 0) AS "debit",
      COALESCE(SUM(vl."amount") FILTER (WHERE vl."side" = 'CR' AND v."date" >= ${from}::date AND v."date" <= ${toIso}::date), 0) AS "credit"
    FROM "Ledger" l
    JOIN "AccountGroup" g ON g."id" = l."groupId"
    LEFT JOIN "VoucherLine" vl ON vl."ledgerId" = l."id"
    LEFT JOIN "Voucher" v ON v."id" = vl."voucherId"
    WHERE l."companyId" = ${companyId}
    GROUP BY l."id", g."id"
    ORDER BY g."name", l."name"`;

  const zero = new Decimal(0);
  let totOpenDr = zero, totOpenCr = zero, totDr = zero, totCr = zero, totCloseDr = zero, totCloseCr = zero;

  const ledgers = rows.map((r) => {
    const opening = d(r.opening);
    const debit = d(r.debit);
    const credit = d(r.credit);
    const closing = opening.plus(debit).minus(credit);
    const openDr = opening.gt(0) ? opening : zero;
    const openCr = opening.lt(0) ? opening.neg() : zero;
    const closeDr = closing.gt(0) ? closing : zero;
    const closeCr = closing.lt(0) ? closing.neg() : zero;
    totOpenDr = totOpenDr.plus(openDr);
    totOpenCr = totOpenCr.plus(openCr);
    totDr = totDr.plus(debit);
    totCr = totCr.plus(credit);
    totCloseDr = totCloseDr.plus(closeDr);
    totCloseCr = totCloseCr.plus(closeCr);
    return {
      ledgerId: r.id,
      ledger: r.name,
      group: r.groupName,
      nature: r.nature,
      openingDr: openDr.toFixed(2),
      openingCr: openCr.toFixed(2),
      debit: debit.toFixed(2),
      credit: credit.toFixed(2),
      closingDr: closeDr.toFixed(2),
      closingCr: closeCr.toFixed(2),
    };
  });

  return {
    from,
    to: toIso,
    ledgers,
    totals: {
      openingDr: totOpenDr.toFixed(2),
      openingCr: totOpenCr.toFixed(2),
      debit: totDr.toFixed(2),
      credit: totCr.toFixed(2),
      closingDr: totCloseDr.toFixed(2),
      closingCr: totCloseCr.toFixed(2),
    },
    // Movement always balances (enforced by DB). Opening/closing balance only if opening balances were entered correctly.
    isBalanced: totDr.eq(totCr) && totCloseDr.eq(totCloseCr),
    difference: totCloseDr.minus(totCloseCr).toFixed(2),
  };
}

/** Ledger statement with running balance (Dr positive). */
export async function ledgerStatement(companyId: string, ledgerId: string, fromIso: string, toIso: string) {
  const ledger = await prisma.ledger.findFirst({ where: { id: ledgerId, companyId }, include: { group: true } });
  if (!ledger) throw notFound('Ledger');
  const from = parseDate(fromIso);
  const to = parseDate(toIso);

  const before = await prisma.voucherLine.groupBy({
    by: ['side'],
    where: { ledgerId, voucher: { companyId, date: { lt: from } } },
    _sum: { amount: true },
  });
  let balance = new Decimal(ledger.openingBalance.toString()).times(ledger.openingSide === 'DR' ? 1 : -1);
  for (const b of before) {
    const amt = new Decimal((b._sum.amount ?? 0).toString());
    balance = b.side === 'DR' ? balance.plus(amt) : balance.minus(amt);
  }
  const opening = balance;

  const lines = await prisma.voucherLine.findMany({
    where: { ledgerId, voucher: { companyId, date: { gte: from, lte: to } } },
    include: { voucher: true },
    orderBy: [{ voucher: { date: 'asc' } }, { voucher: { createdAt: 'asc' } }, { lineNo: 'asc' }],
  });

  const entries = lines.map((l) => {
    const amt = new Decimal(l.amount.toString());
    balance = l.side === 'DR' ? balance.plus(amt) : balance.minus(amt);
    return {
      date: isoDate(l.voucher.date),
      voucherId: l.voucherId,
      voucherNumber: l.voucher.number,
      type: l.voucher.type,
      narration: l.narration ?? l.voucher.narration,
      debit: l.side === 'DR' ? amt.toFixed(2) : '0.00',
      credit: l.side === 'CR' ? amt.toFixed(2) : '0.00',
      balance: balance.abs().toFixed(2),
      balanceSide: balance.gte(0) ? 'DR' : 'CR',
    };
  });

  return {
    ledger: { id: ledger.id, name: ledger.name, group: ledger.group.name },
    from: fromIso,
    to: toIso,
    opening: { amount: opening.abs().toFixed(2), side: opening.gte(0) ? 'DR' : 'CR' },
    entries,
    closing: { amount: balance.abs().toFixed(2), side: balance.gte(0) ? 'DR' : 'CR' },
  };
}
