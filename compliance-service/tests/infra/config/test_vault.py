from types import SimpleNamespace

import pytest
from requests.exceptions import ConnectionError as RequestsConnectionError

from compliance_service.infra.config.vault import VaultSettings, load_settings

VAULT = VaultSettings(
    _env_file=None,
    vault_addr="http://vault:8200",
    vault_role_id="role-123",
    vault_secret_id="secret-456",
)


class FakeVaultClient:
    def __init__(self, secret=None, login_error=None):
        self.logins = []
        self.reads = []
        self._secret = secret or {}
        self._login_error = login_error
        self.auth = SimpleNamespace(approle=SimpleNamespace(login=self._login))
        self.secrets = SimpleNamespace(kv=SimpleNamespace(v2=SimpleNamespace(read_secret_version=self._read)))

    def _login(self, role_id, secret_id):
        if self._login_error:
            raise self._login_error
        self.logins.append((role_id, secret_id))

    def _read(self, path, mount_point, raise_on_deleted_version):
        self.reads.append((mount_point, path))
        return {"data": {"data": self._secret}}


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in ("DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"):
        monkeypatch.delenv(name, raising=False)


def test_builds_settings_with_the_credentials_in_vault():
    client = FakeVaultClient({"db_username": "compliance", "db_password": "secret"})

    settings = load_settings(VAULT, client)

    assert settings.database_url == "postgresql+asyncpg://compliance:secret@localhost:5433/compliance"
    assert client.logins == [("role-123", "secret-456")]
    assert client.reads == [("secret", "compliance-service")]


def test_rejects_a_secret_without_a_credential():
    client = FakeVaultClient({"db_username": "compliance"})

    with pytest.raises(RuntimeError, match="secret/compliance-service is missing db_password"):
        load_settings(VAULT, client)


def test_names_the_vault_address_when_vault_is_unreachable():
    client = FakeVaultClient(login_error=RequestsConnectionError("connection refused"))

    with pytest.raises(RuntimeError, match="http://vault:8200") as error:
        load_settings(VAULT, client)

    assert "secret-456" not in str(error.value)
