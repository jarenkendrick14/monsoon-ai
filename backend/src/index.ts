import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';

import { config } from './config.js';
import { logger } from './utils/logger.js';
import { authenticatePb, ensureCollections } from './pb.js';
import { setupWebSocket } from './ws.js';
import { startJobs } from './jobs/index.js';

import { apiGeneral } from './middleware/rateLimiter.js';

import healthRouter from './routes/healthRoutes.js';
import authRouter from './routes/authRoutes.js';
import userRouter from './routes/userRoutes.js';
import riskRouter from './routes/riskRoutes.js';
import geocodeRouter from './routes/geocodeRoutes.js';
import dashboardRouter from './routes/dashboardRoutes.js';
import alertRouter from './routes/alertRoutes.js';
import evacRouter from './routes/evacRoutes.js';
import mapRouter from './routes/mapRoutes.js';
import chatRouter from './routes/chatRoutes.js';
import smsRouter from './routes/smsRoutes.js';
import govRouter from './routes/govRoutes.js';

const app = express();

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({
  origin: (origin, cb) => {
    const allowed = config.corsOrigin.split(',').map(s => s.trim());
    // No origin = server-to-server or curl — allow
    // Explicit wildcard in config = dev mode, allow all
    if (!origin || allowed.includes('*')) return cb(null, true);
    if (allowed.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: ${origin} not allowed`));
  },
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(apiGeneral);

app.use(healthRouter);
app.use(authRouter);
app.use(userRouter);
app.use(riskRouter);
app.use(geocodeRouter);
app.use(dashboardRouter);
app.use(alertRouter);
app.use(evacRouter);
app.use(mapRouter);
app.use(chatRouter);
app.use(smsRouter);
app.use(govRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', err);
  res.status(500).json({ error: 'Internal server error' });
});

async function main(): Promise<void> {
  await authenticatePb();
  await ensureCollections();

  const server = createServer(app);
  setupWebSocket(server);
  startJobs();

  server.listen(config.port, () => {
    logger.info(`MonsoonAI API running on port ${config.port} [${config.nodeEnv}]`);
  });
}

main().catch((err) => {
  logger.error('Fatal startup error', err);
  process.exit(1);
});
