import { loadVaultOptions, readVaultSecret, VaultOptions } from './vault';

const options: VaultOptions = {
  address: 'http://vault:8200',
  roleId: 'role-123',
  secretId: 'secret-456',
  secretPath: 'catalog-service',
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const loginOk = () => json(200, { auth: { client_token: 'token-789' } });

describe('readVaultSecret', () => {
  it('logs in with the AppRole and reads the secret with the client token', async () => {
    const fetchFn = jest.fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(json(200, { data: { data: { db_username: 'catalog', db_password: 'secret' } } }));

    const secret = await readVaultSecret(options, fetchFn);

    expect(secret).toEqual({ db_username: 'catalog', db_password: 'secret' });
    expect(fetchFn).toHaveBeenNthCalledWith(1, 'http://vault:8200/v1/auth/approle/login', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ role_id: 'role-123', secret_id: 'secret-456' }),
    }));
    expect(fetchFn).toHaveBeenNthCalledWith(2, 'http://vault:8200/v1/secret/data/catalog-service', expect.objectContaining({
      headers: { 'X-Vault-Token': 'token-789' },
    }));
  });

  it('rejects a failed login without exposing the secret id', async () => {
    const fetchFn = jest.fn().mockResolvedValueOnce(json(400, { errors: ['invalid role or secret ID'] }));

    const error = await readVaultSecret(options, fetchFn).catch((err: Error) => err);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('Vault login failed');
    expect((error as Error).message).toContain('400');
    expect((error as Error).message).not.toContain('secret-456');
  });

  it('rejects a denied read naming the secret path', async () => {
    const fetchFn = jest.fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(json(403, { errors: ['permission denied'] }));

    await expect(readVaultSecret(options, fetchFn)).rejects.toThrow(/secret\/catalog-service.*403/);
  });

  it('rejects naming the Vault address when Vault is unreachable', async () => {
    const fetchFn = jest.fn().mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(readVaultSecret(options, fetchFn)).rejects.toThrow('http://vault:8200');
  });
});

describe('loadVaultOptions', () => {
  it('reads the AppRole from env with local defaults', () => {
    expect(loadVaultOptions({ VAULT_ROLE_ID: 'role', VAULT_SECRET_ID: 'secret' })).toEqual({
      address: 'http://localhost:8200',
      roleId: 'role',
      secretId: 'secret',
      secretPath: 'catalog-service',
    });
  });

  it('requires VAULT_ROLE_ID', () => {
    expect(() => loadVaultOptions({ VAULT_SECRET_ID: 'secret' })).toThrow('Missing VAULT_ROLE_ID');
  });

  it('requires VAULT_SECRET_ID', () => {
    expect(() => loadVaultOptions({ VAULT_ROLE_ID: 'role' })).toThrow('Missing VAULT_SECRET_ID');
  });
});
