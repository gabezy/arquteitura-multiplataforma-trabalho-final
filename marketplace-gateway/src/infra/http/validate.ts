import { z } from 'zod';

export interface ValidationIssue {
  path: string;
  message: string;
}

// A request whose values break the contract, although it is well formed: answered with 422.
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

export function parseRequest<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new RequestValidationError(result.error);
  }

  return result.data;
}
