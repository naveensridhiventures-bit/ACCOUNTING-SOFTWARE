import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { D, ZERO } from '../../lib/money';
import { parseDate } from '../../lib/dates';
import { ledgerPositions } from '../../lib/balances';

interface RateRow { gstRate: Prisma.Decimal; taxable: Prisma.Decimal; cgst: Prisma.Decimal; sgst: Prisma.Decimal; igst: Prisma.Decimal; b2b: boolean; docType: string }

export async function gstSummary(companyId: string, from: string, to: string) {
  const f = parseDate(from), t = parseDate(to);
  const lines = await prisma.$queryRaw<RateRow[]>`
    SELECT dl."gstRate", d."type"::text AS "docType", (p."gstin" IS NOT NULL AND p."gstin" <> '') AS "b2b",
      SUM(dl."taxableAmount") AS "taxable", SUM(dl."cgstAmount") AS "cgst", SUM(dl."sgstAmount") AS "sgst", SUM(dl."igstAmount") AS "igst"
    FROM "DocumentLine" dl
    JOIN "Document" d ON d."id" = dl."documentId"
    JOIN "Party" p ON p."id" = d."partyId"
    WHERE d."companyId" = ${companyId} AND d."status" = 'ACTIVE' AND d."date" >= ${f} AND d."date" <= ${t}
    GROUP BY dl."gstRate", d."type", 2, 3
    ORDER BY dl."gstRate"`;

  type Acc = { taxable: Decimal; cgst: Decimal; sgst: Decimal; igst: Decimal };
  const zero = (): Acc => ({ taxable: ZERO, cgst: ZERO, sgst: ZERO, igst: ZERO });
  const fmt = (a: Acc) => ({ taxable: a.taxable.toFixed(2), cgst: a.cgst.toFixed(2), sgst: a.sgst.toFixed(2), igst: a.igst.toFixed(2), tax: a.cgst.plus(a.sgst).plus(a.igst).toFixed(2) });

  const bucket = (outward: boolean) => {
    const byRate = new Map<string, Acc>();
    const total = zero();
    const b2b = zero(), b2c = zero();
    for (const r of lines) {
      const isOut = r.docType === 'SALES_INVOICE' || r.docType === 'CREDIT_NOTE';
      if (isOut !== outward) continue;
      const sign = r.docType === 'CREDIT_NOTE' || r.docType === 'DEBIT_NOTE' ? -1 : 1; // notes reduce the base
      const key = D(r.gstRate).toFixed(2);
      const e = byRate.get(key) ?? zero();
      const add = (a: Acc) => {
        a.taxable = a.taxable.plus(D(r.taxable).times(sign));
        a.cgst = a.cgst.plus(D(r.cgst).times(sign));
        a.sgst = a.sgst.plus(D(r.sgst).times(sign));
        a.igst = a.igst.plus(D(r.igst).times(sign));
      };
      add(e); add(total); add(r.b2b ? b2b : b2c);
      byRate.set(key, e);
    }
    return {
      byRate: [...byRate.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([rate, a]) => ({ rate, ...fmt(a) })),
      total: fmt(total), b2b: fmt(b2b), b2c: fmt(b2c),
    };
  };

  // Authoritative liability comes from the GST ledgers (includes ITC on expenses and manual adjustments).
  const pos = await ledgerPositions(companyId, from, to);
  const key = async () => {
    const l = await prisma.ledger.findMany({ where: { companyId, systemKey: { in: ['OUTPUT_CGST', 'OUTPUT_SGST', 'OUTPUT_IGST', 'INPUT_CGST', 'INPUT_SGST', 'INPUT_IGST'] } }, select: { id: true, systemKey: true } });
    return new Map(l.map((x) => [x.systemKey!, x.id]));
  };
  const keys = await key();
  const mov = (k: string) => {
    const r = pos.find((p) => p.id === keys.get(k));
    return r ? { debit: r.debit, credit: r.credit } : { debit: ZERO, credit: ZERO };
  };
  const head = (h: 'CGST' | 'SGST' | 'IGST') => {
    const o = mov(`OUTPUT_${h}`), i = mov(`INPUT_${h}`);
    const output = o.credit.minus(o.debit);
    const input = i.debit.minus(i.credit);
    return { head: h, output: output.toFixed(2), input: input.toFixed(2), payable: output.minus(input).toFixed(2) };
  };
  const heads = [head('CGST'), head('SGST'), head('IGST')];
  const netPayable = heads.reduce((a, h) => a.plus(D(h.payable)), ZERO);

  // HSN summary of outward supplies
  const hsn = await prisma.$queryRaw<{ hsn: string | null; unit: string | null; qty: Prisma.Decimal; taxable: Prisma.Decimal; cgst: Prisma.Decimal; sgst: Prisma.Decimal; igst: Prisma.Decimal }[]>`
    SELECT dl."hsn", dl."unit",
      SUM(CASE WHEN d."type" = 'CREDIT_NOTE' THEN -dl."qty" ELSE dl."qty" END) AS "qty",
      SUM(CASE WHEN d."type" = 'CREDIT_NOTE' THEN -dl."taxableAmount" ELSE dl."taxableAmount" END) AS "taxable",
      SUM(CASE WHEN d."type" = 'CREDIT_NOTE' THEN -dl."cgstAmount" ELSE dl."cgstAmount" END) AS "cgst",
      SUM(CASE WHEN d."type" = 'CREDIT_NOTE' THEN -dl."sgstAmount" ELSE dl."sgstAmount" END) AS "sgst",
      SUM(CASE WHEN d."type" = 'CREDIT_NOTE' THEN -dl."igstAmount" ELSE dl."igstAmount" END) AS "igst"
    FROM "DocumentLine" dl JOIN "Document" d ON d."id" = dl."documentId"
    WHERE d."companyId" = ${companyId} AND d."status" = 'ACTIVE' AND d."type" IN ('SALES_INVOICE', 'CREDIT_NOTE') AND d."date" >= ${f} AND d."date" <= ${t}
    GROUP BY dl."hsn", dl."unit" ORDER BY dl."hsn"`;

  return {
    from, to,
    outward: bucket(true),
    inward: bucket(false),
    liability: { heads, netPayable: netPayable.toFixed(2) },
    hsn: hsn.map((h) => ({ hsn: h.hsn ?? '-', unit: h.unit ?? '', qty: D(h.qty).toFixed(3), taxable: D(h.taxable).toFixed(2), cgst: D(h.cgst).toFixed(2), sgst: D(h.sgst).toFixed(2), igst: D(h.igst).toFixed(2) })),
  };
}
