import Decimal from 'decimal.js';
import { EntrySide, Prisma, VoucherType } from '@prisma/client';
import { prisma, Tx } from '../../lib/prisma';
import { AppError, notFound } from '../../lib/errors';
import { isoDate, parseDate } from '../../lib/dates';

export interface LineInput {
  ledgerId: string;
  side: EntrySide;
  amount: string | number;
  narration?: string | undefined;
}

export interface PostVoucherInput {
  type: VoucherType;
  date: string; // YYYY-MM-DD
  narration?: string | undefined;
  /** Cheque number, UTR, supplier invoice number, ... */
  reference?: string | undefined;
  /** Origin of the voucher (INVOICE, PAYMENT, EXPENSE, ADJUSTMENT, OPENING, CLOSING, MANUAL). */
  source?: string | undefined;
  lines: LineInput[];
}

export interface Actor {
  companyId: string;
  userId: string;
}

const PREFIX: Record<VoucherType, string> = {
  SALES: 'SAL',
  PURCHASE: 'PUR',
  PAYMENT: 'PAY',
  RECEIPT: 'RCT',
  CONTRA: 'CNT',
  JOURNAL: 'JRN',
  CREDIT_NOTE: 'CRN',
  DEBIT_NOTE: 'DBN',
};

/**
 * Pure validation of voucher lines. Throws AppError on any violation.
 * Returns the voucher total (sum of debits == sum of credits).
 */
export function validateLines(lines: LineInput[]): { total: Decimal } {
  if (lines.length < 2) {
    throw new AppError(422, 'VOUCHER_TOO_FEW_LINES', 'A voucher needs at least two lines');
  }
  let debit = new Decimal(0);
  let credit = new Decimal(0);
  lines.forEach((l, i) => {
    let amt: Decimal;
    try {
      amt = new Decimal(l.amount);
    } catch {
      throw new AppError(422, 'INVALID_AMOUNT', `Line ${i + 1}: amount is not a number`);
    }
    if (!amt.isFinite() || amt.lte(0)) {
      throw new AppError(422, 'INVALID_AMOUNT', `Line ${i + 1}: amount must be greater than zero`);
    }
    if (amt.decimalPlaces() > 2) {
      throw new AppError(422, 'INVALID_AMOUNT', `Line ${i + 1}: at most 2 decimal places allowed`);
    }
    if (l.side === 'DR') debit = debit.plus(amt);
    else credit = credit.plus(amt);
  });
  if (!debit.eq(credit)) {
    throw new AppError(422, 'VOUCHER_UNBALANCED', 'Total debits must equal total credits', {
      debit: debit.toFixed(2),
      credit: credit.toFixed(2),
    });
  }
  return { total: debit };
}

async function prefixFor(tx: Tx, companyId: string, type: VoucherType) {
  const company = await tx.company.findUnique({ where: { id: companyId }, select: { numberPrefixes: true } });
  const custom = (company?.numberPrefixes as Record<string, unknown> | null)?.[type];
  return typeof custom === 'string' && /^[A-Za-z0-9/_-]{1,12}$/.test(custom) ? custom : PREFIX[type];
}

async function nextNumber(tx: Tx, companyId: string, financialYearId: string, type: VoucherType) {
  // Single atomic statement: safe under concurrency, gap-free as long as the transaction commits.
  const rows = await tx.$queryRaw<{ lastNumber: number }[]>`
    INSERT INTO "VoucherSequence" ("companyId", "financialYearId", "type", "lastNumber")
    VALUES (${companyId}, ${financialYearId}, ${type}::"VoucherType", 1)
    ON CONFLICT ("companyId", "financialYearId", "type")
    DO UPDATE SET "lastNumber" = "VoucherSequence"."lastNumber" + 1
    RETURNING "lastNumber"`;
  const n = rows[0]?.lastNumber;
  if (!n) throw new AppError(500, 'SEQUENCE_ERROR', 'Could not allocate voucher number');
  return `${await prefixFor(tx, companyId, type)}-${String(n).padStart(5, '0')}`;
}

export async function postVoucherTx(tx: Tx, actor: Actor, input: PostVoucherInput, reversesId?: string) {
  const { total } = validateLines(input.lines);
  const date = parseDate(input.date);

  const fy = await tx.financialYear.findFirst({
    where: { companyId: actor.companyId, startDate: { lte: date }, endDate: { gte: date } },
  });
  if (!fy) throw new AppError(422, 'NO_FINANCIAL_YEAR', `No financial year covers ${input.date}`);
  if (fy.isClosed) throw new AppError(422, 'FINANCIAL_YEAR_CLOSED', `Financial year ${fy.name} is closed`);

  const ledgerIds = [...new Set(input.lines.map((l) => l.ledgerId))];
  const found = await tx.ledger.count({
    where: { id: { in: ledgerIds }, companyId: actor.companyId, isActive: true },
  });
  if (found !== ledgerIds.length) {
    throw new AppError(422, 'INVALID_LEDGER', 'One or more ledgers do not exist or are inactive');
  }

  const number = await nextNumber(tx, actor.companyId, fy.id, input.type);
  const voucher = await tx.voucher.create({
    data: {
      companyId: actor.companyId,
      financialYearId: fy.id,
      type: input.type,
      number,
      date,
      narration: input.narration ?? null,
      reference: input.reference ?? null,
      source: input.source ?? null,
      totalAmount: total.toFixed(2),
      createdById: actor.userId,
      reversesId: reversesId ?? null,
      lines: {
        create: input.lines.map((l, i) => ({
          lineNo: i + 1,
          ledgerId: l.ledgerId,
          side: l.side,
          amount: new Decimal(l.amount).toFixed(2),
          narration: l.narration ?? null,
        })),
      },
    },
    include: { lines: { orderBy: { lineNo: 'asc' } } },
  });

  // Run the database's balance check now, as an ordinary statement inside the transaction.
  // (If left to fire at COMMIT, a failure there leaks the connection in the pg driver adapter.)
  await tx.$executeRaw`SET CONSTRAINTS "VoucherLine_balanced_trg" IMMEDIATE`;

  await tx.auditLog.create({
    data: {
      companyId: actor.companyId,
      userId: actor.userId,
      action: reversesId ? 'VOUCHER_REVERSAL_POSTED' : 'VOUCHER_POSTED',
      entity: 'Voucher',
      entityId: voucher.id,
      data: { number, type: input.type, total: total.toFixed(2), reversesId: reversesId ?? null, source: input.source ?? null },
    },
  });
  return voucher;
}

export function postVoucher(actor: Actor, input: PostVoucherInput) {
  return prisma.$transaction((tx) => postVoucherTx(tx, actor, input));
}

/**
 * Reverse a posted voucher by posting an equal and opposite voucher.
 * The original is marked REVERSED; nothing is edited or deleted.
 */
export function reverseVoucher(actor: Actor, voucherId: string, opts: { date?: string | undefined; reason?: string | undefined }) {
  return prisma.$transaction((tx) => reverseVoucherTx(tx, actor, voucherId, opts));
}

export async function reverseVoucherTx(tx: Tx, actor: Actor, voucherId: string, opts: { date?: string | undefined; reason?: string | undefined }) {
  // Row lock prevents two concurrent reversals of the same voucher.
  await tx.$queryRaw`SELECT "id" FROM "Voucher" WHERE "id" = ${voucherId} AND "companyId" = ${actor.companyId} FOR UPDATE`;
  const original = await tx.voucher.findFirst({
    where: { id: voucherId, companyId: actor.companyId },
    include: { lines: { orderBy: { lineNo: 'asc' } } },
  });
  if (!original) throw notFound('Voucher');
  if (original.reversesId) {
    throw new AppError(409, 'CANNOT_REVERSE_REVERSAL', 'A reversal voucher cannot itself be reversed; post a new voucher instead');
  }
  if (original.status !== 'POSTED') {
    throw new AppError(409, 'ALREADY_REVERSED', `Voucher ${original.number} is already reversed`);
  }

  const reversal = await postVoucherTx(
    tx,
    actor,
    {
      type: original.type,
      date: opts.date ?? isoDate(original.date),
      narration: `Reversal of ${original.number}${opts.reason ? `: ${opts.reason}` : ''}`,
      source: original.source ?? undefined,
      lines: original.lines.map((l) => ({
        ledgerId: l.ledgerId,
        side: l.side === 'DR' ? 'CR' : 'DR',
        amount: l.amount.toString(),
        narration: l.narration ?? undefined,
      })),
    },
    original.id,
  );

  await tx.voucher.update({ where: { id: original.id }, data: { status: 'REVERSED' } });
  await tx.auditLog.create({
    data: {
      companyId: actor.companyId,
      userId: actor.userId,
      action: 'VOUCHER_REVERSED',
      entity: 'Voucher',
      entityId: original.id,
      data: { reversalId: reversal.id, reason: opts.reason ?? null } as Prisma.InputJsonValue,
    },
  });
  return reversal;
}
