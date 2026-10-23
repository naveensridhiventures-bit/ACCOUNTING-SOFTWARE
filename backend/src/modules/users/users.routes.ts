import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { AppError, notFound } from '../../lib/errors';
import { actor, requirePermission } from '../../middleware/auth';
import { PERMISSION_CATALOG } from '../../lib/defaults';
import { uuid } from '../../lib/http';

export const usersRouter = Router();
const password = z.string().min(10, 'Use at least 10 characters').max(200);
const publicUser = { id: true, name: true, email: true, isActive: true, lastLoginAt: true, createdAt: true, roleId: true, role: { select: { id: true, name: true } } } as const;

usersRouter.get('/users', requirePermission('user.read'), async (req, res) => {
  const items = await prisma.user.findMany({ where: { companyId: actor(req).companyId }, select: publicUser, orderBy: { name: 'asc' } });
  res.json({ items });
});

usersRouter.post('/users', requirePermission('user.write'), async (req, res) => {
  const b = z.object({ name: z.string().trim().min(1).max(100), email: z.string().trim().email().toLowerCase(), password, roleId: uuid }).parse(req.body);
  const a = actor(req);
  const role = await prisma.role.findFirst({ where: { id: b.roleId, companyId: a.companyId } });
  if (!role) throw new AppError(422, 'INVALID_ROLE', 'Role not found');
  if (await prisma.user.findUnique({ where: { email: b.email } })) throw new AppError(409, 'CONFLICT', 'A user with this email already exists');
  const u = await prisma.user.create({ data: { companyId: a.companyId, roleId: role.id, name: b.name, email: b.email, passwordHash: await bcrypt.hash(b.password, 12) }, select: publicUser });
  await prisma.auditLog.create({ data: { companyId: a.companyId, userId: a.userId, action: 'USER_CREATED', entity: 'User', entityId: u.id, data: { email: u.email, role: role.name } } });
  res.status(201).json(u);
});

usersRouter.patch('/users/:id', requirePermission('user.write'), async (req, res) => {
  const b = z.object({ name: z.string().trim().min(1).max(100).optional(), roleId: uuid.optional(), isActive: z.boolean().optional(), password: password.optional() }).parse(req.body);
  const a = actor(req);
  const u = await prisma.user.findFirst({ where: { id: String(req.params.id), companyId: a.companyId }, include: { role: true } });
  if (!u) throw notFound('User');
  const newRole = b.roleId ? await prisma.role.findFirst({ where: { id: b.roleId, companyId: a.companyId } }) : null;
  if (b.roleId && !newRole) throw new AppError(422, 'INVALID_ROLE', 'Role not found');
  // Never leave the company without an active administrator.
  const losesAdmin = u.role.permissions.includes('*') && ((newRole && !newRole.permissions.includes('*')) || b.isActive === false);
  if (losesAdmin) {
    const otherAdmins = await prisma.user.count({ where: { companyId: a.companyId, isActive: true, id: { not: u.id }, role: { permissions: { has: '*' } } } });
    if (!otherAdmins) throw new AppError(409, 'LAST_ADMIN', 'At least one active administrator is required');
  }
  if (u.id === a.userId && b.isActive === false) throw new AppError(409, 'SELF_DEACTIVATE', 'You cannot deactivate your own account');
  const updated = await prisma.user.update({
    where: { id: u.id },
    data: { ...(b.name && { name: b.name }), ...(b.roleId && { roleId: b.roleId }), ...(b.isActive !== undefined && { isActive: b.isActive }), ...(b.password && { passwordHash: await bcrypt.hash(b.password, 12) }) },
    select: publicUser,
  });
  await prisma.auditLog.create({ data: { companyId: a.companyId, userId: a.userId, action: 'USER_UPDATED', entity: 'User', entityId: u.id, data: { fields: Object.keys(b).filter((k) => k !== 'password'), passwordReset: !!b.password } } });
  res.json(updated);
});

// ---------------------------------------------------------------------- roles
usersRouter.get('/permissions', requirePermission('user.read'), (_req, res) => res.json({ items: PERMISSION_CATALOG }));

usersRouter.get('/roles', requirePermission('user.read'), async (req, res) => {
  const roles = await prisma.role.findMany({ where: { companyId: actor(req).companyId }, orderBy: { name: 'asc' }, include: { _count: { select: { users: true } } } });
  res.json({ items: roles.map((r) => ({ id: r.id, name: r.name, permissions: r.permissions, isSystem: r.isSystem, users: r._count.users })) });
});

const roleBody = z.object({ name: z.string().trim().min(1).max(60), permissions: z.array(z.enum(PERMISSION_CATALOG.map((p) => p.key) as [string, ...string[]])).max(100) });
usersRouter.post('/roles', requirePermission('user.write'), async (req, res) => {
  const b = roleBody.parse(req.body);
  const a = actor(req);
  const r = await prisma.role.create({ data: { companyId: a.companyId, name: b.name, permissions: [...new Set(b.permissions)] } });
  await prisma.auditLog.create({ data: { companyId: a.companyId, userId: a.userId, action: 'ROLE_CREATED', entity: 'Role', entityId: r.id, data: { name: r.name } } });
  res.status(201).json(r);
});

usersRouter.patch('/roles/:id', requirePermission('user.write'), async (req, res) => {
  const b = roleBody.partial().parse(req.body);
  const a = actor(req);
  const r = await prisma.role.findFirst({ where: { id: String(req.params.id), companyId: a.companyId } });
  if (!r) throw notFound('Role');
  if (r.isSystem) throw new AppError(409, 'SYSTEM_ROLE', 'Built-in roles cannot be edited. Create a custom role instead.');
  const updated = await prisma.role.update({ where: { id: r.id }, data: { ...(b.name && { name: b.name }), ...(b.permissions && { permissions: [...new Set(b.permissions)] }) } });
  await prisma.auditLog.create({ data: { companyId: a.companyId, userId: a.userId, action: 'ROLE_UPDATED', entity: 'Role', entityId: r.id, data: { name: updated.name } } });
  res.json(updated);
});

usersRouter.delete('/roles/:id', requirePermission('user.write'), async (req, res) => {
  const a = actor(req);
  const r = await prisma.role.findFirst({ where: { id: String(req.params.id), companyId: a.companyId }, include: { _count: { select: { users: true } } } });
  if (!r) throw notFound('Role');
  if (r.isSystem) throw new AppError(409, 'SYSTEM_ROLE', 'Built-in roles cannot be deleted');
  if (r._count.users) throw new AppError(409, 'ROLE_IN_USE', 'Reassign the users of this role first');
  await prisma.role.delete({ where: { id: r.id } });
  res.status(204).end();
});
