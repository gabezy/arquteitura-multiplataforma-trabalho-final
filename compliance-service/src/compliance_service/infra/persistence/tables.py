from sqlalchemy import Column, DateTime, MetaData, Table, Text, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB

metadata = MetaData()

product_analyses = Table(
    "product_analyses",
    metadata,
    Column("id", Uuid, primary_key=True),
    Column("product_id", Text, nullable=False),
    Column("sku", Text, nullable=False),
    Column("status", Text, nullable=False),
    Column("violations", JSONB, nullable=False),
    Column("analyzed_at", DateTime(timezone=True), nullable=False),
)

processed_events = Table(
    "processed_events",
    metadata,
    Column("event_id", Text, primary_key=True),
    Column("event_type", Text, nullable=False),
    Column("processed_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
)
