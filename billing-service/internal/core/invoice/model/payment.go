package model

import (
	"strings"
	"time"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/shared/domain"
)

// maxPaymentRetryDelay caps the wait between two attempts to create the charge.
const maxPaymentRetryDelay = 60 * time.Second

// paymentRetryDelay is min(2^attempts, 60) seconds, where attempts counts the failed ones so far.
func paymentRetryDelay(attempts int) time.Duration {
	const secondsAtTheCap = 6 // 2^6 = 64 s is already above the cap
	if attempts >= secondsAtTheCap {
		return maxPaymentRetryDelay
	}
	return time.Duration(1<<attempts) * time.Second
}

// IsPaymentDue reports whether the charge must be requested now: the invoice is
// still issued and the wait after the last failed attempt is over.
func (i *Invoice) IsPaymentDue(now time.Time) bool {
	next := i.state.NextPaymentAttemptAt
	return i.state.Status == StatusIssued && (next == nil || !next.After(now))
}

// MarkPaymentPending records that the PSP accepted the charge. Repeating it for
// the same charge changes nothing.
func (i *Invoice) MarkPaymentPending(chargeID string, now time.Time) error {
	if strings.TrimSpace(chargeID) == "" {
		return domain.NewValidationError("charge id must not be blank")
	}
	switch i.state.Status {
	case StatusIssued:
		i.state.Status = StatusPaymentPending
		i.state.PSPTransactionID = chargeID
		i.state.PaymentRequestedAt = &now
		i.state.NextPaymentAttemptAt = nil
		i.state.UpdatedAt = now
		return nil
	case StatusPaymentPending:
		if i.state.PSPTransactionID == chargeID {
			return nil
		}
	}
	return domain.NewConflictError("invoice %s is %s and cannot take the charge %s", i.state.ID, i.state.Status, chargeID)
}

// PaymentAttemptFailed records that the PSP could not be reached. The invoice stays
// issued and the next attempt waits min(2^attempts, 60) seconds.
func (i *Invoice) PaymentAttemptFailed(now time.Time) {
	if i.state.Status != StatusIssued {
		return
	}
	i.state.PaymentAttempts++
	next := now.Add(paymentRetryDelay(i.state.PaymentAttempts))
	i.state.NextPaymentAttemptAt = &next
	i.state.UpdatedAt = now
}

// ConfirmPayment records that the PSP reports the payment, and reports whether
// it changed. The same outcome again changes nothing, and an outcome that
// contradicts the invoice is a ConflictError.
func (i *Invoice) ConfirmPayment(chargeID string, paidAt time.Time) (bool, error) {
	if strings.TrimSpace(chargeID) == "" {
		return false, domain.NewValidationError("charge id must not be blank")
	}
	switch i.state.Status {
	case StatusIssued, StatusPaymentPending:
		if known := i.state.PSPTransactionID; known != "" && known != chargeID {
			return false, domain.NewConflictError("invoice %s has the charge %s, not %s", i.state.ID, known, chargeID)
		}
		i.state.Status = StatusPaid
		i.state.PSPTransactionID = chargeID
		i.state.PaidAt = &paidAt
		i.state.NextPaymentAttemptAt = nil
		i.state.UpdatedAt = paidAt
		i.Record(PaymentConfirmed{
			InvoiceID:        i.state.ID,
			OrderID:          i.state.OrderID,
			Amount:           i.state.Total,
			PSPTransactionID: chargeID,
			PaidAt:           paidAt,
		})
		return true, nil
	case StatusPaid:
		if i.state.PSPTransactionID == chargeID {
			return false, nil
		}
	}
	return false, domain.NewConflictError("invoice %s is %s and cannot be reported paid with the charge %s", i.state.ID, i.state.Status, chargeID)
}

// FailPayment records that the PSP refused the payment, and reports whether it
// changed. chargeID is empty when the PSP refused to create the charge. The same
// outcome again changes nothing, and an outcome that contradicts the invoice is a ConflictError.
func (i *Invoice) FailPayment(chargeID, reason string, failedAt time.Time) (bool, error) {
	if strings.TrimSpace(reason) == "" {
		return false, domain.NewValidationError("failure reason must not be blank")
	}
	known := i.state.PSPTransactionID
	switch i.state.Status {
	case StatusIssued, StatusPaymentPending:
		if known != "" && chargeID != "" && known != chargeID {
			return false, domain.NewConflictError("invoice %s has the charge %s, not %s", i.state.ID, known, chargeID)
		}
		if chargeID != "" {
			i.state.PSPTransactionID = chargeID
		}
		i.state.Status = StatusPaymentFailed
		i.state.FailureReason = reason
		i.state.FailedAt = &failedAt
		i.state.NextPaymentAttemptAt = nil
		i.state.UpdatedAt = failedAt
		i.Record(PaymentFailed{
			InvoiceID:        i.state.ID,
			OrderID:          i.state.OrderID,
			Amount:           i.state.Total,
			PSPTransactionID: i.state.PSPTransactionID,
			Reason:           reason,
			FailedAt:         failedAt,
		})
		return true, nil
	case StatusPaymentFailed:
		if chargeID == "" || chargeID == known {
			return false, nil
		}
	}
	return false, domain.NewConflictError("invoice %s is %s and cannot be reported failed with the charge %q", i.state.ID, i.state.Status, chargeID)
}
