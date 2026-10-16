#!/bin/sh
# Creates the topics the services publish to or consume from. Run by the kafka-init
# service in ../../compose.yaml. Safe to run again: existing topics are left as they are.
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
create produto.analisado.v1 3
create catalog.product-analysis.dlq 1 retention.ms=1209600000 # 14 days to inspect and replay

# compliance-service
create compliance.product-created.dlq 1 retention.ms=1209600000 # 14 days to inspect and replay

/opt/kafka/bin/kafka-topics.sh --bootstrap-server "$BOOTSTRAP_SERVER" --list
