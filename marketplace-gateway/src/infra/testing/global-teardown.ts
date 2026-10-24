import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedTestContainer } from 'testcontainers';

export default async function globalTeardown(): Promise<void> {
    const started = (globalThis as { __CONTAINERS__?: { postgres?: StartedPostgreSqlContainer; wiremock?: StartedTestContainer } }).__CONTAINERS__;

    await Promise.all([started?.postgres?.stop(), started?.wiremock?.stop()]);
}
