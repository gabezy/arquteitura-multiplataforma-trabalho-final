import { AppConfig, loadConfig } from './env';
import { loadVaultOptions, readVaultSecret } from './vault';

// Builds the config with the database credentials read from Vault; the rest comes from env.
export async function loadAppConfig(
  env: NodeJS.ProcessEnv = process.env,
  fetchFn: typeof fetch = fetch,
): Promise<AppConfig> {
  const options = loadVaultOptions(env);
  const secret = await readVaultSecret(options, fetchFn);
  const credential = (key: string): string => {
    const value = secret[key];
    if (!value) {
      throw new Error(`Vault secret secret/${options.secretPath} is missing ${key}`);
    }
    return value;
  };

  return loadConfig({ username: credential('db_username'), password: credential('db_password') }, env);
}
