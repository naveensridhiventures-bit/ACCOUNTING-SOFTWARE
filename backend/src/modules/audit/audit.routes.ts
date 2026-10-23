import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { parseDate } from '../../lib/dates';
import { actor, requirePermission } from '../../middleware/auth';
import { dateStr, pageQuery } from '../../lib/http';

export const auditRouter = Router();

auditRouter.get('/audit-logs', requirePermission('audit.read'), async (req, res) => {
  const q = z.object({ entity: z.string().optional(), action: z.string().optional(), userId: z.string().uuid().optional(), q: z.string().trim().optional(), from: dateStr.optional(), to: dateStr.optional(), ...pageQuery }).parse(req.query);
  const a = actor(req);
  const where: Prisma.AuditLogWhereInput = {
    companyId: a.companyId,
    ...(q.entity && { entity: q.entity }),
    ...(q.action && { action: { contains: q.action, mode: 'insensitive' } }),
    ...(q.userId && { userId: q.userId }),
    ...((q.from || q.to) && { createdAt: { ...(q.from && { gte: parseDate(q.from) }), ...(q.to && { lt: new Date(parseDate(q.to).getTime() + 86400000) }) } }),
  };
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.auditLog.count({ where }),
  ]);
  const users = new Map((await prisma.user.findMany({ where: { companyId: a.companyId }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  res.json({ items: rows.map((r) => ({ ...r, userName: r.userId ? users.get(r.userId) ?? null : null })), total, page: q.page, pageSize: q.pageSize });
});
