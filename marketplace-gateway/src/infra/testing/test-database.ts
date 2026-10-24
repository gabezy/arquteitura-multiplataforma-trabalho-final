import { randomBytes } from 'node:crypto';
import knex, { Knex } from 'knex';

export interface TestDatabase {
  db: Knex;
  connectionUri: string;
  destroy(): Promise<void>;
}

function adminUri(): string {
  const uri = process.env.TEST_POSTGRES_URI;
  if (!uri) {
    throw new Error('TEST_POSTGRES_URI is not set: specs that need Postgres are named *.int.spec.ts and run in the "integration" Jest project.');
  }
  return uri;
}

async function withAdminConnection<T>(fn: (admin: Knex) => Promise<T>): Promise<T> {
  const admin = knex({ client: 'pg', connection: adminUri() });
  try {
    return await fn(admin);
  } finally {
    await admin.destroy();
  }
}

// Each spec file works in its own database inside the Postgres started by global-setup.ts,
// so specs never see each other's rows and none of them pays for a container of its own.
export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `spec_${randomBytes(6).toString('hex')}`;
  await withAdminConnection(admin => admin.raw(`create database ${name}`));

  const uri = new URL(adminUri());
  uri.pathname = `/${name}`;
  const connectionUri = uri.toString();
  const db = knex({ client: 'pg', connection: connectionUri });

  return {
    db,
    connectionUri,
    destroy: async () => {
      await db.destroy();
      await withAdminConnection(admin => admin.raw(`drop database if exists ${name} with (force)`));
    },
  };
}
