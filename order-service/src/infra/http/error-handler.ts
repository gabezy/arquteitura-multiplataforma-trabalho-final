import { STATUS_CODES } from 'node:http';
import { ErrorRequestHandler, Request, Response } from 'express';
import { Logger } from 'pino';
import { ConflictError, DomainError, NotFoundError, ValidationError } from '../../core/shared/domain/domain.error';
import { RequestValidationError } from './validate';

const BAD_REQUEST = 400;
const INTERNAL_SERVER_ERROR = 500;

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    // The issues name the parameters and say what is wrong with them, never the values sent.
    if (err instanceof RequestValidationError) {
      logger.warn({ issues: err.issues, method: req.method, path: req.path }, err.message);
      sendProblem(req, res, BAD_REQUEST, err.message, { errors: err.issues });
      return;
    }

    if (err instanceof DomainError) {
      logger.warn({ err, method: req.method, path: req.path }, err.message);
      sendProblem(req, res, statusOf(err), err.message);
      return;
    }

    const clientErrorStatus = clientErrorStatusOf(err);
    if (clientErrorStatus) {
      // body-parser errors carry the raw request body in err.body, and a JSON SyntaxError
      // message may quote part of it, so only safe fields are logged.
      logger.warn(
        { status: clientErrorStatus, errType: err.type, method: req.method, path: req.path },
        'Client error',
      );
      sendProblem(req, res, clientErrorStatus, err.message);
      return;
    }

    logger.error({ err, method: req.method, path: req.path }, 'Unhandled error');
    sendProblem(req, res, INTERNAL_SERVER_ERROR);
  };
}

function statusOf(err: DomainError): number {
  if (err instanceof ValidationError) return 422;
  if (err instanceof NotFoundError) return 404;
  if (err instanceof ConflictError) return 409;
  return INTERNAL_SERVER_ERROR;
}

// Errors raised by Express middleware (e.g. malformed JSON from express.json())
// carry a 4xx status and expose=true when their message is safe to return.
function clientErrorStatusOf(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const { status, expose } = err as { status?: unknown; expose?: unknown };
  if (typeof status === 'number' && status >= 400 && status < 500 && expose === true) {
    return status;
  }
  return undefined;
}

function sendProblem(
  req: Request,
  res: Response,
  status: number,
  detail?: string,
  extensions: Record<string, unknown> = {},
): void {
  res.status(status).type('application/problem+json').json({
    type: 'about:blank',
    title: STATUS_CODES[status],
    status,
    detail,
    instance: req.originalUrl,
    ...extensions,
  });
}
