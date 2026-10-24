import { parseDay } from './day';

describe('parseDay', () => {
  it.each(['2026-10-28', '2028-02-29', '2026-12-31', '2026-01-01', '0001-01-01'])('reads %s as the start of that day in UTC', value => {
    expect(parseDay(value)?.toISOString().slice(0, 10)).toBe(value.padStart(10, '0'));
    expect(parseDay(value)?.getUTCHours()).toBe(0);
  });

  it('reads a day at midnight UTC, whatever the time zone of the process', () => {
    expect(parseDay('2026-10-28')?.getTime()).toBe(Date.UTC(2026, 9, 28));
  });

  it.each([
    ['a day that does not exist', '2026-02-30'],
    ['a leap day of a common year', '2026-02-29'],
    ['a month that does not exist', '2026-13-01'],
    ['day zero', '2026-10-00'],
    ['a date with a time', '2026-10-28T10:00:00Z'],
    ['a day without leading zeros', '2026-1-1'],
    ['another format', '28/10/2026'],
    ['a day with spaces', ' 2026-10-28'],
    ['an expanded year', '+012026-10-28'],
    ['an empty text', ''],
    ['no text', undefined],
  ])('rejects %s', (_, value) => {
    expect(parseDay(value as string)).toBeNull();
  });
});
