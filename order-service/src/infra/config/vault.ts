export interface VaultOptions {
  address: string;
  roleId: string;
  secretId: string;
  secretPath: string;
}

interface LoginResponse {
  auth: { client_token: string };
}

interface KvReadResponse {
  data: { data: Record<string, string> };
}

const KV_MOUNT = 'secret';

export function loadVaultOptions(env: NodeJS.ProcessEnv = process.env): VaultOptions {
  return {
    address: env.VAULT_ADDR ?? 'http://localhost:8200',
    roleId: required(env, 'VAULT_ROLE_ID'),
    secretId: required(env, 'VAULT_SECRET_ID'),
    secretPath: env.VAULT_SECRET_PATH ?? 'order-service',
  };
}

// Logs in with the AppRole and reads the KV v2 secret. Errors name the address and path, never the credentials.
export async function readVaultSecret(
  options: VaultOptions,
  fetchFn: typeof fetch = fetch,
): Promise<Record<string, string>> {
  const login = await request(fetchFn, options.address, `${options.address}/v1/auth/approle/login`, {
    method: 'POST',
    body: JSON.stringify({ role_id: options.roleId, secret_id: options.secretId }),
  });
  if (!login.ok) {
    throw new Error(`Vault login failed at ${options.address}: HTTP ${login.status}`);
  }
  const { auth } = (await login.json()) as LoginResponse;

  const read = await request(fetchFn, options.address, `${options.address}/v1/${KV_MOUNT}/data/${options.secretPath}`, {
    headers: { 'X-Vault-Token': auth.client_token },
  });
  if (!read.ok) {
    throw new Error(`Vault read of ${KV_MOUNT}/${options.secretPath} failed: HTTP ${read.status}`);
  }
  const { data } = (await read.json()) as KvReadResponse;
  return data.data;
}

async function request(fetchFn: typeof fetch, address: string, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchFn(url, init);
  } catch (err) {
    throw new Error(`Vault unreachable at ${address}`, { cause: err });
  }
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}
