import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { authLimiter, apiLimiter } from './middleware/rateLimit.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import { healthRouter } from './routes/health.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { rafflesRouter } from './routes/raffles.routes.js';
import { meRouter } from './routes/me.routes.js';
import { ordersRouter } from './routes/orders.routes.js';
import { adminRouter } from './routes/admin.routes.js';
import { verifyRouter } from './routes/verify.routes.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: env.corsOrigin, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  if (env.nodeEnv !== 'test') app.use(morgan('dev'));

  app.use('/health', healthRouter);

  app.get('/api/payment-info', (_req, res) => {
    res.json({
      alias: env.payment.alias,
      cbu: env.payment.cbu,
      holder: env.payment.holder,
      bank: env.payment.bank,
    });
  });

  app.use('/api', apiLimiter);
  app.use('/api/auth', authLimiter, authRouter);
  app.use('/api/raffles', rafflesRouter);
  app.use('/api/verify', verifyRouter);
  app.use('/api/me', meRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/admin', adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
