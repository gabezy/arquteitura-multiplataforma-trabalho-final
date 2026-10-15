import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError


async def test_creates_the_tables(engine):
    async with engine.connect() as connection:
        names = await connection.run_sync(lambda sync: sa.inspect(sync).get_table_names())

    assert {"product_analyses", "processed_events"} <= set(names)


async def test_constrains_the_analysis_status(engine):
    with pytest.raises(IntegrityError):
        async with engine.begin() as connection:
            await connection.execute(
                sa.text(
                    "INSERT INTO product_analyses (id, product_id, sku, status, analyzed_at) "
                    "VALUES (gen_random_uuid(), 'p-1', 'SKU-1', 'MAYBE', now())"
                )
            )
