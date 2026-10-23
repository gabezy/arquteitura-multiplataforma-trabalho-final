import { Router } from 'express';
import { Logger } from 'pino';

const SERVICE_UNAVAILABLE = 503;

export function healthRoutes(checkDatabase: () => Promise<void>, logger: Logger): Router {
  const router = Router();
  router.get('/health', async (_req, res) => {
    try {
      await checkDatabase();
      res.json({ status: 'UP' });
    } catch (err) {
      logger.warn({ err }, 'Health check failed: database unavailable');
      res.status(SERVICE_UNAVAILABLE).json({ status: 'DOWN' });
    }
  });
  return router;
}
