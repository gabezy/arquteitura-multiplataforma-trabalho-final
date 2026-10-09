import { ErrorRequestHandler } from 'express';
import { Logger } from 'pino';

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    logger.error({ err, method: req.method, path: req.path }, 'Unhandled error');
    res.status(500).type('application/problem+json').json({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
    });
  };
}
