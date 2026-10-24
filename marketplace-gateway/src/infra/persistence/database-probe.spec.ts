import knex, { Knex } from 'knex';
import { createDatabaseProbe } from './database-probe';

describe('createDatabaseProbe', () => {
  it('runs select 1 and resolves when the database answers', async () => {
    const raw = jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });

    await expect(createDatabaseProbe({ raw } as unknown as Knex)()).resolves.toBeUndefined();

    expect(raw).toHaveBeenCalledWith('select 1');
  });

  it('rejects when the database is unreachable', async () => {
    const unreachable = knex({ client: 'pg', connection: 'postgresql://marketplace:marketplace@127.0.0.1:1/marketplace' });

    await expect(createDatabaseProbe(unreachable)()).rejects.toThrow('ECONNREFUSED');
    await unreachable.destroy();
  });

  describe('with a database that never answers', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    const hungDatabase = { raw: () => new Promise(() => {}) } as unknown as Knex;

    it('rejects once 2 s have passed', async () => {
      const outcome = createDatabaseProbe(hungDatabase)().then(
        () => 'resolved',
        (err: Error) => err.message,
      );

      await jest.advanceTimersByTimeAsync(1_999);
      await jest.advanceTimersByTimeAsync(1);

      await expect(outcome).resolves.toBe('Database did not answer within 2000 ms');
    });

    it('is still pending just before 2 s', async () => {
      let settled = false;
      createDatabaseProbe(hungDatabase)().then(
        () => (settled = true),
        () => (settled = true),
      );

      await jest.advanceTimersByTimeAsync(1_999);

      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
    });
  });
});
