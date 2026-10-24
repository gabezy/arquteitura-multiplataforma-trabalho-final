package httpapi

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/port/in"
)

const (
	webhookTokenHeader = "X-PSP-Token"
	maxWebhookBody     = 64 << 10
)

// webhookBody is what the PSP reports about a charge. Fields it adds later are ignored.
type webhookBody struct {
	ChargeID      string  `json:"chargeId"`
	Reference     string  `json:"reference"`
	Status        string  `json:"status"`
	FailureReason *string `json:"failureReason"`
	OccurredAt    *string `json:"occurredAt"`
}

// pspWebhook is where the PSP reports the outcome of a charge. The same outcome reported again
// is a 204 that changes nothing.
func (r *Router) pspWebhook(w http.ResponseWriter, req *http.Request) error {
	if !validWebhookToken(req.Header.Get(webhookTokenHeader), r.deps.WebhookToken) {
		return &unauthorizedError{Message: "payment webhook rejected: missing or wrong " + webhookTokenHeader}
	}

	result, err := parsePaymentResult(http.MaxBytesReader(w, req.Body, maxWebhookBody))
	if err != nil {
		return err
	}
	changed, err := r.deps.Payments.ApplyPaymentResult(req.Context(), result)
	if err != nil {
		return err
	}

	message := "payment result applied"
	if !changed {
		message = "payment result repeated, nothing changed"
	}
	r.deps.Logger.InfoContext(req.Context(), message, "invoiceId", result.InvoiceID, "chargeId", result.ChargeID, "status", string(result.Status))
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// validWebhookToken compares digests so that the time it takes does not tell how much of the token matched.
// A server without a configured token accepts nobody.
func validWebhookToken(got, want string) bool {
	if want == "" {
		return false
	}
	gotDigest, wantDigest := sha256.Sum256([]byte(got)), sha256.Sum256([]byte(want))
	return subtle.ConstantTimeCompare(gotDigest[:], wantDigest[:]) == 1
}

// parsePaymentResult reads the body of the webhook. chargeId, reference (the invoice id) and status
// are required; occurredAt is optional but must be a time when present. Every invalid field is named in the 400.
func parsePaymentResult(body io.Reader) (in.PaymentResult, error) {
	decoder := json.NewDecoder(body)
	var payload webhookBody
	if err := decoder.Decode(&payload); err != nil {
		return in.PaymentResult{}, &requestError{Message: "the webhook body is not a valid JSON object", Issues: []string{"body"}}
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return in.PaymentResult{}, &requestError{Message: "the webhook body is not a valid JSON object", Issues: []string{"body"}}
	}

	var invalid []string
	if strings.TrimSpace(payload.ChargeID) == "" {
		invalid = append(invalid, "chargeId")
	}
	if _, err := uuid.Parse(payload.Reference); err != nil {
		invalid = append(invalid, "reference")
	}
	status := in.PaymentStatus(payload.Status)
	if status != in.PaymentPaid && status != in.PaymentFailed {
		invalid = append(invalid, "status")
	}
	var occurredAt time.Time
	if payload.OccurredAt != nil {
		parsed, err := time.Parse(time.RFC3339, *payload.OccurredAt)
		if err != nil {
			invalid = append(invalid, "occurredAt")
		}
		occurredAt = parsed
	}
	if len(invalid) > 0 {
		return in.PaymentResult{}, &requestError{
			Message: "invalid webhook body: chargeId is required, reference must be the invoice id, status must be PAID or FAILED and occurredAt an RFC 3339 time",
			Issues:  invalid,
		}
	}

	result := in.PaymentResult{
		InvoiceID:  payload.Reference,
		ChargeID:   payload.ChargeID,
		Status:     status,
		OccurredAt: occurredAt,
	}
	if payload.FailureReason != nil {
		result.FailureReason = *payload.FailureReason
	}
	return result, nil
}
