-- +goose Up
-- Expand only: the previous version keeps working on the invoices it knows (the new columns are nullable or have a default).
ALTER TABLE invoices
    ADD COLUMN psp_transaction_id      TEXT,
    ADD COLUMN failure_reason          TEXT,
    ADD COLUMN payment_attempts        INTEGER     NOT NULL DEFAULT 0,
    ADD COLUMN next_payment_attempt_at TIMESTAMPTZ,
    ADD COLUMN payment_requested_at    TIMESTAMPTZ,
    ADD COLUMN paid_at                 TIMESTAMPTZ,
    ADD COLUMN failed_at               TIMESTAMPTZ,
    -- A charge at the PSP belongs to one invoice. Invoices with no charge yet all have NULL, which is allowed.
    ADD CONSTRAINT invoices_psp_transaction_id_unique UNIQUE (psp_transaction_id);

-- The payment worker looks for the oldest issued invoice whose next attempt has come.
CREATE INDEX invoices_payment_due_idx ON invoices (issued_at, id) WHERE status = 'ISSUED';
-- The reconciliation looks for the charges that have been pending for a while.
CREATE INDEX invoices_payment_pending_idx ON invoices (payment_requested_at) WHERE status = 'PAYMENT_PENDING';

-- +goose Down
DROP INDEX invoices_payment_pending_idx;
DROP INDEX invoices_payment_due_idx;
ALTER TABLE invoices
    DROP CONSTRAINT invoices_psp_transaction_id_unique,
    DROP COLUMN failed_at,
    DROP COLUMN paid_at,
    DROP COLUMN payment_requested_at,
    DROP COLUMN next_payment_attempt_at,
    DROP COLUMN payment_attempts,
    DROP COLUMN failure_reason,
    DROP COLUMN psp_transaction_id;
