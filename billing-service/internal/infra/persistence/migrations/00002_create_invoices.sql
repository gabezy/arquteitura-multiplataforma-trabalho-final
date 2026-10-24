-- +goose Up
CREATE TABLE invoices (
    id                  UUID        PRIMARY KEY,
    order_id            UUID        NOT NULL,
    external_order_id   TEXT,
    marketplace         TEXT        NOT NULL,
    total_cents         BIGINT      NOT NULL CHECK (total_cents >= 0),
    commission_rate_bps INTEGER     NOT NULL CHECK (commission_rate_bps BETWEEN 0 AND 10000),
    commission_cents    BIGINT      NOT NULL CHECK (commission_cents >= 0),
    net_cents           BIGINT      NOT NULL CHECK (net_cents >= 0),
    status              TEXT        NOT NULL,
    issued_at           TIMESTAMPTZ NOT NULL,
    cancelled_at        TIMESTAMPTZ,
    cancellation_reason TEXT,
    updated_at          TIMESTAMPTZ NOT NULL,
    version             INTEGER     NOT NULL DEFAULT 1,
    -- One invoice per order, even when Kafka redelivers the confirmation or two instances race.
    CONSTRAINT invoices_order_id_unique UNIQUE (order_id),
    CONSTRAINT invoices_status_valid CHECK (status IN ('ISSUED', 'PAYMENT_PENDING', 'PAID', 'PAYMENT_FAILED', 'CANCELLED'))
);

CREATE INDEX invoices_newest_first_idx ON invoices (issued_at DESC, id DESC);
CREATE INDEX invoices_status_idx ON invoices (status);

CREATE TABLE invoice_items (
    invoice_id       UUID     NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
    line             SMALLINT NOT NULL,
    sku              TEXT     NOT NULL,
    quantity         INTEGER  NOT NULL CHECK (quantity > 0),
    unit_price_cents BIGINT   NOT NULL CHECK (unit_price_cents > 0),
    PRIMARY KEY (invoice_id, line)
);

-- Orders cancelled before their confirmation arrived: Kafka gives no order across topics.
CREATE TABLE order_cancellations (
    order_id     UUID        PRIMARY KEY,
    reason       TEXT,
    cancelled_at TIMESTAMPTZ NOT NULL
);

-- +goose Down
DROP TABLE order_cancellations;
DROP TABLE invoice_items;
DROP TABLE invoices;
