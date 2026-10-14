import { RequestHandler } from 'express';
import { z } from 'zod';

type RequestPart = 'body' | 'params' | 'query';

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

export function validate(schema: z.ZodType, part: RequestPart = 'body'): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req[part]);

    if (!result.success) {
      next(new RequestValidationError(result.error));
      return;
    }

    // Replaces the body with the parsed value, which drops unknown fields.
    // params and query are only checked: Express 5 exposes query as a getter.
    if (part === 'body') {
      req.body = result.data;
    }
    next();
  };
}
