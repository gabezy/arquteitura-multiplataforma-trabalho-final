import { z } from 'zod';
import { parseDay } from '../../../core/order/model/day';

const day = z.string().refine(value => parseDay(value) !== null, 'must be a day as YYYY-MM-DD');

// The same period rules as the facade, here to answer 400 with the parameter that is wrong. This check also
// runs when a day is invalid, and that day is already reported, so it only judges two valid days.
export const salesReportQuerySchema = z.object({
  from: day,
  to: day,
}).refine(
  ({ from, to }) => {
    const firstDay = parseDay(from);
    const lastDay = parseDay(to);
    return firstDay === null || lastDay === null || lastDay.getTime() >= firstDay.getTime();
  },
  { path: ['to'], message: 'must not be before from' },
);
