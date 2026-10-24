#!/bin/sh
# Creates the topics the services publish to or consume from. Run by the kafka-init
# service in ../../docker-compose.yaml. Safe to run again: existing topics are left as they are.
set -eu

BOOTSTRAP_SERVER="${KAFKA_BOOTSTRAP_SERVER:-kafka:19092}"

# create <topic> <partitions> [config]
create() {
  /opt/kafka/bin/kafka-topics.sh --bootstrap-server "$BOOTSTRAP_SERVER" \
    --create --if-not-exists \
    --topic "$1" --partitions "$2" --replication-factor 1 \
    ${3:+--config "$3"}
}

# catalog-service: one topic per event, named after its public type
create catalog.product.created.v1 3
create catalog.product.approved.v1 3
create catalog.product.rejected.v1 3
create catalog.stock.reserved.v1 3
create catalog.stock.insufficient.v1 3
create catalog.product.stock-changed.v1 3
create produto.analisado.v1 3
create catalog.product-analysis.dlq 1 retention.ms=1209600000 # 14 days to inspect and replay
create catalog.order-stock.dlq 1 retention.ms=1209600000 # 14 days to inspect and replay

# order-service (consumed by catalog-service until order-service exists)
create order.order.placed.v1 3
create order.order.cancelled.v1 3

# marketplace-gateway (consumes catalog.product.approved.v1, catalog.product.stock-changed.v1 and order.order.cancelled.v1)
create marketplace.order.received.v1 3
create marketplace.listing.published.v1 3
create marketplace.listing.failed.v1 3
create marketplace.catalog-product.dlq 1 retention.ms=1209600000 # 14 days to inspect and replay
create marketplace.order-cancelled.dlq 1 retention.ms=1209600000 # 14 days to inspect and replay

# compliance-service
create compliance.product-created.dlq 1 retention.ms=1209600000 # 14 days to inspect and replay

/opt/kafka/bin/kafka-topics.sh --bootstrap-server "$BOOTSTRAP_SERVER" --list
