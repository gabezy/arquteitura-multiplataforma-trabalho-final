import { z } from 'zod';
import { RequestValidationError } from './validate';

describe('RequestValidationError', () => {
  it('names each invalid field by its path, with what is wrong and no value', () => {
    const parsed = z.object({
      limit: z.number(),
      filter: z.object({ status: z.string() }),
    }).safeParse({ limit: 'secret', filter: { status: 7 } });

    const error = new RequestValidationError(parsed.error!);

    expect(error.message).toBe('Request validation failed.');
    expect(error.issues.map(issue => issue.path)).toEqual(['limit', 'filter.status']);
    expect(JSON.stringify(error.issues)).not.toContain('secret');
  });
});
