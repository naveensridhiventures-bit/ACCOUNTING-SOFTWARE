import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import { allowedOrigins } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { errorHandler, notFoundHandler } from './middleware/error';
import { authRouter } from './modules/auth/auth.routes';
import { authenticate } from './middleware/auth';
import { accountingRouter } from './modules/accounting/accounting.routes';
import { companyRouter } from './modules/company/company.routes';
import { usersRouter } from './modules/users/users.routes';
import { auditRouter } from './modules/audit/audit.routes';
import { partiesRouter } from './modules/parties/parties.routes';
import { productsRouter } from './modules/inventory/products.routes';
import { documentsRouter } from './modules/sales/documents.routes';
import { paymentsRouter } from './modules/payments/payments.routes';
import { bankingRouter } from './modules/banking/banking.routes';
import { reportsRouter } from './modules/reports/reports.routes';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // Render terminates TLS at its proxy
  app.use(helmet());
  app.use(cors({ origin: allowedOrigins, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] }));
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'degraded', database: 'unreachable' });
    }
  });

  const api = express.Router();
  api.use(rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));
  api.use('/auth', authRouter);
  // Everything below requires a valid session; authentication runs once per request.
  api.use(authenticate);
  for (const r of [accountingRouter, companyRouter, usersRouter, auditRouter, partiesRouter, productsRouter, documentsRouter, paymentsRouter, bankingRouter, reportsRouter]) api.use('/', r);
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
