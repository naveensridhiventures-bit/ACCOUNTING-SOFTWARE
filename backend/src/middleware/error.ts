import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction) {
  next(new AppError(404, 'NOT_FOUND', 'Route not found'));
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
    });
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  const dbCode = (err as { code?: string; cause?: { originalCode?: string } })?.cause?.originalCode ?? (err as { code?: string })?.code;
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    return res.status(409).json({ error: { code: 'CONFLICT', message: 'A record with these values already exists' } });
  }
  // Raised by database integrity triggers/constraints (balance, immutability, CHECKs).
  if (dbCode === '23514' || dbCode === '23001') {
    return res.status(422).json({ error: { code: 'INTEGRITY_VIOLATION', message: 'Operation rejected by database integrity rules' } });
  }
  req.log?.error({ err }, 'Unhandled error');
  logger.debug({ err }, 'unhandled');
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
}
