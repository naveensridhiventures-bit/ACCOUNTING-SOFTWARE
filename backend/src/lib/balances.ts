import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { D } from './money';

export interface LedgerRow {
  id: string;
  name: string;
  groupId: string;
  groupName: string;
  nature: 'ASSET' | 'LIABILITY' | 'INCOME' | 'EXPENSE';
  isActive: boolean;
  /** Signed: debit positive, credit negative. */
  opening: Decimal;
  /** Movement before `from`, signed. */
  pre: Decimal;
  debit: Decimal;
  credit: Decimal;
}

interface Raw {
  id: string; name: string; groupId: string; groupName: string; nature: string; isActive: boolean;
  opening: Prisma.Decimal; pre: Prisma.Decimal; debit: Prisma.Decimal; credit: Prisma.Decimal;
}

/**
 * Per-ledger position over a period, in one query.
 * - opening: ledger opening balance (signed)
 * - pre:     voucher movement strictly before `from`
 * - debit / credit: movement within [from, to]
 * `excludeSources` leaves out vouchers by origin (e.g. year-end CLOSING vouchers for profit & loss).
 * Reversed vouchers stay in (their reversal vouchers net them out), so every total reconciles to the ledger statement.
 */
export async function ledgerPositions(companyId: string, from: string | null, to: string, opts: { excludeSources?: string[]; ledgerIds?: string[] } = {}): Promise<LedgerRow[]> {
  const excl = opts.excludeSources?.length ? Prisma.sql`AND COALESCE(v."source", '') NOT IN (${Prisma.join(opts.excludeSources)})` : Prisma.empty;
  const only = opts.ledgerIds ? Prisma.sql`AND l."id" IN (${Prisma.join(opts.ledgerIds.length ? opts.ledgerIds : ['00000000-0000-0000-0000-000000000000'])})` : Prisma.empty;
  const fromDate = from ?? '0001-01-01';
  const rows = await prisma.$queryRaw<Raw[]>`
    SELECT l."id", l."name", l."groupId", g."name" AS "groupName", g."nature"::text AS "nature", l."isActive",
      CASE WHEN l."openingSide" = 'DR' THEN l."openingBalance" ELSE -l."openingBalance" END AS "opening",
      COALESCE(SUM(CASE WHEN vl."side" = 'DR' THEN vl."amount" ELSE -vl."amount" END) FILTER (WHERE v."date" < ${fromDate}::date ${excl}), 0) AS "pre",
      COALESCE(SUM(vl."amount") FILTER (WHERE vl."side" = 'DR' AND v."date" >= ${fromDate}::date AND v."date" <= ${to}::date ${excl}), 0) AS "debit",
      COALESCE(SUM(vl."amount") FILTER (WHERE vl."side" = 'CR' AND v."date" >= ${fromDate}::date AND v."date" <= ${to}::date ${excl}), 0) AS "credit"
    FROM "Ledger" l
    JOIN "AccountGroup" g ON g."id" = l."groupId"
    LEFT JOIN "VoucherLine" vl ON vl."ledgerId" = l."id"
    LEFT JOIN "Voucher" v ON v."id" = vl."voucherId"
    WHERE l."companyId" = ${companyId} ${only}
    GROUP BY l."id", g."id"
    ORDER BY g."name", l."name"`;
  return rows.map((r) => ({
    id: r.id, name: r.name, groupId: r.groupId, groupName: r.groupName, nature: r.nature as LedgerRow['nature'], isActive: r.isActive,
    opening: D(r.opening), pre: D(r.pre), debit: D(r.debit), credit: D(r.credit),
  }));
}

/** Closing balance of each ledger as at `asOf` (signed, debit positive). */
export async function ledgerBalances(companyId: string, asOf: string, ledgerIds?: string[]): Promise<Map<string, Decimal>> {
  const out = new Map<string, Decimal>();
  const list = await prisma.$queryRaw<{ id: string; bal: Prisma.Decimal }[]>`
    SELECT l."id",
      CASE WHEN l."openingSide" = 'DR' THEN l."openingBalance" ELSE -l."openingBalance" END
      + COALESCE(SUM(CASE WHEN vl."side" = 'DR' THEN vl."amount" ELSE -vl."amount" END) FILTER (WHERE v."date" <= ${asOf}::date), 0) AS "bal"
    FROM "Ledger" l
    LEFT JOIN "VoucherLine" vl ON vl."ledgerId" = l."id"
    LEFT JOIN "Voucher" v ON v."id" = vl."voucherId"
    WHERE l."companyId" = ${companyId} ${ledgerIds ? Prisma.sql`AND l."id" IN (${Prisma.join(ledgerIds.length ? ledgerIds : ['00000000-0000-0000-0000-000000000000'])})` : Prisma.empty}
    GROUP BY l."id"`;
  for (const r of list) out.set(r.id, D(r.bal));
  return out;
}
