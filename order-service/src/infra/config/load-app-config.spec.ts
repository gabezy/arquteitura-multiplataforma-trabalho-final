import { loadAppConfig } from './load-app-config';

const env = { VAULT_ADDR: 'http://vault:8200', VAULT_ROLE_ID: 'role', VAULT_SECRET_ID: 'secret', DB_HOST: 'order-db' };

const vaultReturning = (secret: Record<string, string>) =>
  jest.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ auth: { client_token: 'token' } }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: { data: secret } }), { status: 200 }));

describe('loadAppConfig', () => {
  it('builds the database url from the credentials in Vault', async () => {
    const config = await loadAppConfig(env, vaultReturning({ db_username: 'orders', db_password: 'secret' }));

    expect(config.databaseUrl).toBe('postgresql://orders:secret@order-db:5434/orders');
  });

  it('rejects when the Vault secret lacks a credential', async () => {
    await expect(loadAppConfig(env, vaultReturning({ db_username: 'orders' })))
      .rejects.toThrow('Vault secret secret/order-service is missing db_password');
  });
});
