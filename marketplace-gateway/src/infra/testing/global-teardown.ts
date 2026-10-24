import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';

export default async function globalTeardown(): Promise<void> {
  const container = (globalThis as { __POSTGRES__?: StartedPostgreSqlContainer }).__POSTGRES__;
  await container?.stop();
}
