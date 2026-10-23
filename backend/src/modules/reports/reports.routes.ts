import { Router } from 'express';
import { z } from 'zod';
import { actor, requirePermission } from '../../middleware/auth';
import { dateStr } from '../../lib/http';
import { isoDate, todayIso } from '../../lib/dates';
import { balanceSheet, fyFor, groupSummary, profitAndLoss } from './financial.service';
import { ageing } from './receivables.service';
import { gstSummary } from './gst.service';
import { dashboard, partySummary, productSummary } from './dashboard.service';

export const reportsRouter = Router();
reportsRouter.use('/reports', requirePermission('report.read'));

const range = z.object({ from: dateStr.optional(), to: dateStr.optional() });
const asOfQ = z.object({ asOf: dateStr.optional() });

/** Default period = current financial year to date. */
async function period(companyId: string, q: { from?: string | undefined; to?: string | undefined }) {
  const to = q.to ?? todayIso();
  if (q.from) return { from: q.from, to };
  const fy = await fyFor(companyId, to);
  return { from: fy ? isoDate(fy.startDate) : `${to.slice(0, 4)}-01-01`, to };
}

reportsRouter.get('/reports/dashboard', async (req, res) => res.json(await dashboard(actor(req).companyId)));

reportsRouter.get('/reports/profit-loss', async (req, res) => {
  const a = actor(req);
  const p = await period(a.companyId, range.parse(req.query));
  res.json(await profitAndLoss(a.companyId, p.from, p.to));
});

reportsRouter.get('/reports/balance-sheet', async (req, res) => {
  const q = asOfQ.parse(req.query);
  res.json(await balanceSheet(actor(req).companyId, q.asOf ?? todayIso()));
});

reportsRouter.get('/reports/group-summary', async (req, res) => {
  const a = actor(req);
  const p = await period(a.companyId, range.parse(req.query));
  res.json(await groupSummary(a.companyId, p.from, p.to));
});

reportsRouter.get('/reports/receivables', async (req, res) => res.json(await ageing(actor(req).companyId, 'RECEIVABLES', asOfQ.parse(req.query).asOf ?? todayIso())));
reportsRouter.get('/reports/payables', async (req, res) => res.json(await ageing(actor(req).companyId, 'PAYABLES', asOfQ.parse(req.query).asOf ?? todayIso())));

reportsRouter.get('/reports/gst', async (req, res) => {
  const a = actor(req);
  const p = await period(a.companyId, range.parse(req.query));
  res.json(await gstSummary(a.companyId, p.from, p.to));
});

reportsRouter.get('/reports/party-summary', async (req, res) => {
  const a = actor(req);
  const q = range.extend({ kind: z.enum(['SALES', 'PURCHASE']).default('SALES') }).parse(req.query);
  const p = await period(a.companyId, q);
  res.json(await partySummary(a.companyId, q.kind, p.from, p.to));
});

reportsRouter.get('/reports/product-summary', async (req, res) => {
  const a = actor(req);
  const q = range.extend({ kind: z.enum(['SALES', 'PURCHASE']).default('SALES') }).parse(req.query);
  const p = await period(a.companyId, q);
  res.json(await productSummary(a.companyId, q.kind, p.from, p.to));
});

