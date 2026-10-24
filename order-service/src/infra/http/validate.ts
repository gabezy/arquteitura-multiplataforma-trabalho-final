import { RequestHandler } from 'express';
import { z } from 'zod';

type RequestPart = 'params' | 'query';

export interface ValidationIssue {
  path: string;
  message: string;
}

export class RequestValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(error: z.ZodError) {
    super('Request validation failed.');
    this.name = 'RequestValidationError';
    this.issues = error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
  }
}

// Express 5 exposes query as a getter that cannot be replaced, so the parsed value (numbers read from the
// text, unknown fields dropped) is handed to the controller in res.locals.
export function validate(schema: z.ZodType, part: RequestPart): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req[part]);

    if (!result.success) {
      next(new RequestValidationError(result.error));
      return;
    }

    res.locals[part] = result.data;
    next();
  };
}
