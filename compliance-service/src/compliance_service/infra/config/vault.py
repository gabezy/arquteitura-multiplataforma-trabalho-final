import hvac
from hvac.exceptions import VaultError
from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from requests.exceptions import RequestException

from compliance_service.infra.config.settings import Settings

KV_MOUNT = "secret"


class VaultSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    vault_addr: str = "http://localhost:8200"
    vault_role_id: str
    vault_secret_id: SecretStr
    vault_secret_path: str = "compliance-service"


def read_vault_secret(settings: VaultSettings, client: hvac.Client | None = None) -> dict[str, str]:
    """Logs in with the AppRole and reads the KV v2 secret. Errors name the address, never the credentials."""
    client = client or hvac.Client(url=settings.vault_addr)
    try:
        client.auth.approle.login(role_id=settings.vault_role_id, secret_id=settings.vault_secret_id.get_secret_value())
        response = client.secrets.kv.v2.read_secret_version(
            path=settings.vault_secret_path, mount_point=KV_MOUNT, raise_on_deleted_version=True
        )
    except (RequestException, VaultError) as error:
        raise RuntimeError(
            f"Could not read {KV_MOUNT}/{settings.vault_secret_path} from Vault at {settings.vault_addr}: "
            f"{type(error).__name__}"
        ) from None
    return response["data"]["data"]


def load_settings(vault_settings: VaultSettings | None = None, client: hvac.Client | None = None) -> Settings:
    """Builds the settings with the database credentials read from Vault; the rest comes from env."""
    vault_settings = vault_settings or VaultSettings()
    secret = read_vault_secret(vault_settings, client)

    def credential(key: str) -> str:
        value = secret.get(key)
        if not value:
            raise RuntimeError(f"Vault secret {KV_MOUNT}/{vault_settings.vault_secret_path} is missing {key}")
        return value

    return Settings(db_user=credential("db_username"), db_password=credential("db_password"))
