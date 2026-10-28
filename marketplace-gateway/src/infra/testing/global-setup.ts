import path from 'node:path';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';

// Same images as docker-compose.yaml: the outbox relies on SKIP LOCKED and jsonb, and the adapters
// are tested against the same WireMock and the same mappings the compose runs.
const POSTGRES_IMAGE = 'postgres:18-alpine';
const WIREMOCK_IMAGE = 'wiremock/wiremock:3.13.2';
const WIREMOCK_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'docker', 'wiremock');
const STARTUP_TIMEOUT_MS = 300_000;

interface StartedContainers {
    postgres?: StartedPostgreSqlContainer;
    wiremock?: StartedTestContainer;
}

// Two containers for the whole run of the "integration" Jest project, started together:
// - one Postgres: each spec file creates its own database in it (see test-database.ts). Its data lives in
//   memory and fsync is off, because the tests need speed, not durability, and the disk of a busy machine
//   makes a container start crawl;
// - one WireMock with the mappings of docker/wiremock, which the specs reset before each test (see wiremock.ts).
// With TEST_POSTGRES_URI (postgres://user:password@host:port/database) or TEST_WIREMOCK_URL (http://host:port)
// set, the run uses that server instead and starts no container for it.
export default async function globalSetup(): Promise<void> {
    const started: StartedContainers = {};

    await Promise.all([
        process.env.TEST_POSTGRES_URI ? undefined : startPostgres().then(container => { started.postgres = container; }),
        process.env.TEST_WIREMOCK_URL ? undefined : startWiremock().then(container => { started.wiremock = container; }),
    ]);

    if (started.postgres) {
        process.env.TEST_POSTGRES_URI = started.postgres.getConnectionUri();
    }
    if (started.wiremock) {
        process.env.TEST_WIREMOCK_URL = `http://${started.wiremock.getHost()}:${started.wiremock.getMappedPort(8080)}`;
    }
    (globalThis as { __CONTAINERS__?: StartedContainers }).__CONTAINERS__ = started;
}

function startPostgres(): Promise<StartedPostgreSqlContainer> {
    return new PostgreSqlContainer(POSTGRES_IMAGE)
        .withTmpFs({ '/var/lib/postgresql': 'rw' })
        .withEnvironment({ POSTGRES_INITDB_ARGS: '--no-sync' })
        .withCommand(['postgres', '-c', 'fsync=off', '-c', 'synchronous_commit=off', '-c', 'full_page_writes=off'])
        .withStartupTimeout(STARTUP_TIMEOUT_MS)
        .start();
}

// The mappings are copied into the container, so WireMock can never write into the repository.
function startWiremock(): Promise<StartedTestContainer> {
    return new GenericContainer(WIREMOCK_IMAGE)
        .withCopyDirectoriesToContainer([
            { source: path.join(WIREMOCK_DIR, 'mappings'), target: '/home/wiremock/mappings' },
            { source: path.join(WIREMOCK_DIR, '__files'), target: '/home/wiremock/__files' },
        ])
        .withExposedPorts(8080)
        .withWaitStrategy(Wait.forHttp('/__admin/mappings', 8080))
        .withStartupTimeout(STARTUP_TIMEOUT_MS)
        .start();
}
