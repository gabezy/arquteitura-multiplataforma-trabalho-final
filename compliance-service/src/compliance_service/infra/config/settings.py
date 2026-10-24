from decimal import Decimal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL


class Settings(BaseSettings):
    # hide_input_in_errors: a validation error would otherwise print the secrets it was given.
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", hide_input_in_errors=True)

    port: int = 8083
    log_level: str = "INFO"
    otel_service_name: str = "compliance-service"
    otel_collector_url: str = "http://localhost:4318"
    db_host: str = "localhost"
    db_port: int = 5433
    db_name: str = "compliance"
    # Read from Vault (secret/compliance-service) by load_settings, never from a file.
    db_user: str
    db_password: SecretStr
    kafka_brokers: str = "localhost:9092"
    product_created_topic: str = "catalog.product.created.v1"
    produto_analisado_topic: str = "produto.analisado.v1"
    product_created_dlq_topic: str = "compliance.product-created.dlq"
    price_ceiling: Decimal = Decimal("100000")
    description_min_length: int = 20

    @property
    def database_url(self) -> str:
        return URL.create(
            "postgresql+asyncpg",
            username=self.db_user,
            password=self.db_password.get_secret_value(),
            host=self.db_host,
            port=self.db_port,
            database=self.db_name,
        ).render_as_string(hide_password=False)

    @property
    def kafka_bootstrap_servers(self) -> list[str]:
        return [broker.strip() for broker in self.kafka_brokers.split(",") if broker.strip()]
