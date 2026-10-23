import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { authenticate } from '../../middleware/auth';

export const authRouter = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
// Used so unknown emails cost the same time as wrong passwords.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

const loginSchema = z.object({ email: z.string().email().transform((s) => s.toLowerCase()), password: z.string().min(1).max(200) });

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email }, include: { role: true } });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok || !user.isActive) throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const token = jwt.sign({ sub: user.id }, env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role.name, permissions: user.role.permissions } });
});

authRouter.get('/me', authenticate, async (req, res) => {
  const company = await prisma.company.findUniqueOrThrow({
    where: { id: req.user!.companyId },
    select: { id: true, name: true, legalName: true, gstin: true, baseCurrency: true, state: true, stateCode: true, gstEnabled: true, allowNegativeStock: true, roundOffInvoices: true },
  });
  res.json({ user: req.user, company });
});

const changePasswordLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
authRouter.post('/change-password', authenticate, changePasswordLimiter, async (req, res) => {
  const { currentPassword, newPassword } = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(10, 'Use at least 10 characters').max(200) }).parse(req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) throw new AppError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect');
  if (currentPassword === newPassword) throw new AppError(422, 'SAME_PASSWORD', 'Choose a different password');
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(newPassword, 12) } });
  await prisma.auditLog.create({ data: { companyId: user.companyId, userId: user.id, action: 'PASSWORD_CHANGED', entity: 'User', entityId: user.id } });
  res.json({ ok: true });
});
