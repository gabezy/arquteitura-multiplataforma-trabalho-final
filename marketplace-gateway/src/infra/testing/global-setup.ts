import { PostgreSqlContainer } from '@testcontainers/postgresql';

// Same image as marketplace-db in ../docker-compose.yaml: the outbox relies on SKIP LOCKED and jsonb.
const POSTGRES_IMAGE = 'postgres:18-alpine';
const STARTUP_TIMEOUT_MS = 180_000;

// One Postgres for the whole run of the "integration" Jest project: each spec file creates its own
// database in it (see test-database.ts). The data directory lives in memory and fsync is off, because
// the tests need speed, not durability, and the disk of a busy machine makes a container start crawl.
// With TEST_POSTGRES_URI set (postgres://user:password@host:port/database) the run uses that server
// instead and starts no container.
export default async function globalSetup(): Promise<void> {
  if (process.env.TEST_POSTGRES_URI) {
    return;
  }

  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withTmpFs({ '/var/lib/postgresql': 'rw' })
    .withEnvironment({ POSTGRES_INITDB_ARGS: '--no-sync' })
    .withCommand(['postgres', '-c', 'fsync=off', '-c', 'synchronous_commit=off', '-c', 'full_page_writes=off'])
    .withStartupTimeout(STARTUP_TIMEOUT_MS)
    .start();

  process.env.TEST_POSTGRES_URI = container.getConnectionUri();
  (globalThis as { __POSTGRES__?: unknown }).__POSTGRES__ = container;
}
