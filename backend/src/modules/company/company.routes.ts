import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { AppError, notFound } from '../../lib/errors';
import { isoDate, parseDate } from '../../lib/dates';
import { actor, requirePermission } from '../../middleware/auth';
import { dateStr, gstin, optStr, pan } from '../../lib/http';
import { INDIAN_STATES } from '../../lib/defaults';
import { postVoucherTx, reverseVoucherTx } from '../accounting/posting.service';
import { systemLedgers } from '../../lib/systemLedgers';
import { closingEntries } from '../reports/financial.service';
import { ZERO } from '../../lib/money';

export const companyRouter = Router();
const empty = (s: z.ZodTypeAny) => z.preprocess((v) => (v === '' || v === null ? undefined : v), s);

companyRouter.get('/company', requirePermission('company.read'), async (req, res) => {
  const c = await prisma.company.findUniqueOrThrow({ where: { id: actor(req).companyId } });
  res.json({ ...c, states: INDIAN_STATES.map(([code, name]) => ({ code, name })) });
});

const companyBody = z.object({
  name: z.string().trim().min(1).max(150),
  legalName: optStr(200),
  gstin: empty(gstin.optional()),
  pan: empty(pan.optional()),
  address: optStr(500),
  city: optStr(100),
  state: optStr(100),
  stateCode: empty(z.string().regex(/^\d{2}$/, 'State code is two digits').optional()),
  pincode: optStr(10),
  phone: optStr(30),
  email: empty(z.string().trim().email().optional()),
  website: optStr(150),
  baseCurrency: z.string().trim().length(3).toUpperCase().optional(),
  bankDetails: optStr(1000),
  invoiceTerms: optStr(2000),
  gstEnabled: z.boolean().optional(),
  allowNegativeStock: z.boolean().optional(),
  roundOffInvoices: z.boolean().optional(),
  numberPrefixes: z.record(z.string().regex(/^[A-Za-z0-9/_-]{1,12}$/, 'Prefix: letters, digits, - _ / (max 12)')).optional(),
});
companyRouter.put('/company', requirePermission('company.write'), async (req, res) => {
  const body = companyBody.partial().parse(req.body);
  const a = actor(req);
  const state = body.stateCode ? INDIAN_STATES.find(([c]) => c === body.stateCode)?.[1] : undefined;
  const c = await prisma.company.update({ where: { id: a.companyId }, data: { ...body, ...(state && !body.state && { state }) } });
  await prisma.auditLog.create({ data: { companyId: a.companyId, userId: a.userId, action: 'COMPANY_UPDATED', entity: 'Company', entityId: c.id, data: { fields: Object.keys(body) } } });
  res.json(c);
});

// ------------------------------------------------------------ financial years
companyRouter.post('/financial-years', requirePermission('fy.manage'), async (req, res) => {
  const b = z.object({ name: z.string().trim().min(1).max(30), startDate: dateStr, endDate: dateStr }).parse(req.body);
  const a = actor(req);
  const start = parseDate(b.startDate), end = parseDate(b.endDate);
  if (end <= start) throw new AppError(422, 'INVALID_RANGE', 'End date must be after start date');
  const overlap = await prisma.financialYear.findFirst({ where: { companyId: a.companyId, startDate: { lte: end }, endDate: { gte: start } } });
  if (overlap) throw new AppError(409, 'OVERLAP', `Overlaps with financial year ${overlap.name}`);
  const fy = await prisma.financialYear.create({ data: { companyId: a.companyId, name: b.name, startDate: start, endDate: end } });
  await prisma.auditLog.create({ data: { companyId: a.companyId, userId: a.userId, action: 'FY_CREATED', entity: 'FinancialYear', entityId: fy.id, data: { name: fy.name } } });
  res.status(201).json(fy);
});

companyRouter.get('/financial-years/:id/closing-preview', requirePermission('fy.manage'), async (req, res) => {
  const { fy, entries, netProfit } = await closingEntries(actor(req).companyId, String(req.params.id));
  res.json({ financialYear: { id: fy.id, name: fy.name, isClosed: fy.isClosed }, netProfit: netProfit.toFixed(2), ledgers: entries.map((e) => ({ ledgerId: e.ledgerId, name: e.name, balance: e.net.abs().toFixed(2), side: e.net.gt(0) ? 'DR' : 'CR' })) });
});

/** Close a year: transfer net profit/loss to Retained Earnings with a CLOSING journal, then lock the year. */
companyRouter.post('/financial-years/:id/close', requirePermission('fy.manage'), async (req, res) => {
  const a = actor(req);
  const id = String(req.params.id);
  const result = await prisma.$transaction(async (tx) => {
    const fy = await tx.financialYear.findFirst({ where: { id, companyId: a.companyId } });
    if (!fy) throw notFound('Financial year');
    if (fy.isClosed) throw new AppError(409, 'ALREADY_CLOSED', `${fy.name} is already closed`);
    const { entries, netProfit } = await closingEntries(a.companyId, id);
    let voucherNumber: string | null = null;
    if (entries.length) {
      const sys = await systemLedgers(tx, a.companyId, ['RETAINED_EARNINGS']);
      const lines = entries.map((e) => ({ ledgerId: e.ledgerId, side: (e.net.gt(0) ? 'CR' : 'DR') as 'CR' | 'DR', amount: e.net.abs().toFixed(2) }));
      if (!netProfit.isZero()) lines.push({ ledgerId: sys.RETAINED_EARNINGS, side: netProfit.gt(0) ? 'CR' : 'DR', amount: netProfit.abs().toFixed(2) });
      const v = await postVoucherTx(tx, a, { type: 'JOURNAL', date: isoDate(fy.endDate), source: 'CLOSING', narration: `Year-end closing ${fy.name}: net ${netProfit.gte(ZERO) ? 'profit' : 'loss'} transferred to Retained Earnings`, lines });
      voucherNumber = v.number;
    }
    await tx.financialYear.update({ where: { id }, data: { isClosed: true } });
    await tx.auditLog.create({ data: { companyId: a.companyId, userId: a.userId, action: 'FY_CLOSED', entity: 'FinancialYear', entityId: id, data: { name: fy.name, netProfit: netProfit.toFixed(2), voucherNumber } } });
    return { closed: true, netProfit: netProfit.toFixed(2), voucherNumber };
  }, { timeout: 30000 });
  res.json(result);
});

companyRouter.post('/financial-years/:id/reopen', requirePermission('fy.manage'), async (req, res) => {
  const a = actor(req);
  const id = String(req.params.id);
  await prisma.$transaction(async (tx) => {
    const fy = await tx.financialYear.findFirst({ where: { id, companyId: a.companyId } });
    if (!fy) throw notFound('Financial year');
    if (!fy.isClosed) throw new AppError(409, 'NOT_CLOSED', `${fy.name} is not closed`);
    const later = await tx.financialYear.findFirst({ where: { companyId: a.companyId, startDate: { gt: fy.startDate }, isClosed: true } });
    if (later) throw new AppError(409, 'LATER_YEAR_CLOSED', `Re-open ${later.name} first`);
    await tx.financialYear.update({ where: { id }, data: { isClosed: false } });
    const closings = await tx.voucher.findMany({ where: { financialYearId: id, companyId: a.companyId, source: 'CLOSING', status: 'POSTED', reversesId: null } });
    for (const v of closings) await reverseVoucherTx(tx, a, v.id, { reason: 'Financial year re-opened' });
    await tx.auditLog.create({ data: { companyId: a.companyId, userId: a.userId, action: 'FY_REOPENED', entity: 'FinancialYear', entityId: id, data: { name: fy.name } } });
  }, { timeout: 30000 });
  res.json({ closed: false });
});
