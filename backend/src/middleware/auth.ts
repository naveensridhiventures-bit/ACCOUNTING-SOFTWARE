import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';

export interface AuthUser {
  id: string;
  companyId: string;
  email: string;
  name: string;
  roleName: string;
  permissions: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new AppError(401, 'UNAUTHENTICATED', 'Missing bearer token');
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(header.slice(7), env.JWT_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
  } catch {
    throw new AppError(401, 'UNAUTHENTICATED', 'Invalid or expired token');
  }
  // Load fresh from DB so deactivation and permission changes apply immediately.
  const user = await prisma.user.findUnique({ where: { id: String(payload.sub) }, include: { role: true } });
  if (!user || !user.isActive) throw new AppError(401, 'UNAUTHENTICATED', 'Account is inactive');
  req.user = {
    id: user.id,
    companyId: user.companyId,
    email: user.email,
    name: user.name,
    roleName: user.role.name,
    permissions: user.role.permissions,
  };
  next();
}

export const requirePermission = (permission: string) => (req: Request, _res: Response, next: NextFunction) => {
  const perms = req.user?.permissions ?? [];
  if (!perms.includes('*') && !perms.includes(permission)) {
    throw new AppError(403, 'FORBIDDEN', `Missing permission: ${permission}`);
  }
  next();
};

/** Express 5 typing helper: the user is guaranteed after `authenticate`. */
export const actor = (req: Request) => {
  if (!req.user) throw new AppError(401, 'UNAUTHENTICATED', 'Not authenticated');
  return { companyId: req.user.companyId, userId: req.user.id };
};

/** True when the authenticated user holds the permission (or the wildcard). */
export const can = (req: Request, permission: string) => {
  const perms = req.user?.permissions ?? [];
  return perms.includes('*') || perms.includes(permission);
};

export function assertCan(req: Request, permission: string) {
  if (!can(req, permission)) throw new AppError(403, 'FORBIDDEN', `Missing permission: ${permission}`);
}
