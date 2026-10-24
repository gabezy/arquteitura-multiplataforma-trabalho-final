package messaging

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/model"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/shared/domain"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/outbox"
)

// The public types of the events of the billing-service, which are also their topics.
const (
	InvoiceIssuedType    = "billing.invoice.issued.v1"
	PaymentConfirmedType = "billing.payment.confirmed.v1"
	PaymentFailedType    = "billing.payment.failed.v1"
)

// invoiceIssuedData is the contract of billing.invoice.issued.v1 (event catalog of #8).
// Money goes out as a JSON number with two decimals, written from integer cents.
type invoiceIssuedData struct {
	InvoiceID         string      `json:"invoiceId"`
	OrderID           string      `json:"orderId"`
	ExternalOrderID   string      `json:"externalOrderId,omitempty"`
	Marketplace       string      `json:"marketplace"`
	Amount            json.Number `json:"amount"`
	CommissionPercent json.Number `json:"commissionPercent"`
	CommissionAmount  json.Number `json:"commissionAmount"`
	NetAmount         json.Number `json:"netAmount"`
	IssuedAt          string      `json:"issuedAt"`
}

// paymentConfirmedData is the contract of billing.payment.confirmed.v1.
type paymentConfirmedData struct {
	InvoiceID        string      `json:"invoiceId"`
	OrderID          string      `json:"orderId"`
	Amount           json.Number `json:"amount"`
	PSPTransactionID string      `json:"pspTransactionId"`
	PaidAt           string      `json:"paidAt"`
}

// paymentFailedData is the contract of billing.payment.failed.v1. The charge id is absent when
// the PSP refused to create the charge.
type paymentFailedData struct {
	InvoiceID        string      `json:"invoiceId"`
	OrderID          string      `json:"orderId"`
	Amount           json.Number `json:"amount"`
	PSPTransactionID string      `json:"pspTransactionId,omitempty"`
	Reason           string      `json:"reason"`
	FailedAt         string      `json:"failedAt"`
}

// ToIntegrationEvent maps a domain event to the integration event the outbox
// stores. An event without a mapping must not leave the service.
func ToIntegrationEvent(event domain.DomainEvent) (outbox.IntegrationEvent, error) {
	switch e := event.(type) {
	case model.InvoiceIssued:
		return invoiceEvent(InvoiceIssuedType, invoiceIssuedData{
			InvoiceID:         e.InvoiceID,
			OrderID:           e.OrderID,
			ExternalOrderID:   e.ExternalOrderID,
			Marketplace:       string(e.Marketplace),
			Amount:            json.Number(e.Total.Decimal()),
			CommissionPercent: json.Number(model.PercentDecimal(e.CommissionRateBps)),
			CommissionAmount:  json.Number(e.Commission.Decimal()),
			NetAmount:         json.Number(e.Net.Decimal()),
			IssuedAt:          formatTime(e.IssuedAt),
		}), nil
	case model.PaymentConfirmed:
		return invoiceEvent(PaymentConfirmedType, paymentConfirmedData{
			InvoiceID:        e.InvoiceID,
			OrderID:          e.OrderID,
			Amount:           json.Number(e.Amount.Decimal()),
			PSPTransactionID: e.PSPTransactionID,
			PaidAt:           formatTime(e.PaidAt),
		}), nil
	case model.PaymentFailed:
		return invoiceEvent(PaymentFailedType, paymentFailedData{
			InvoiceID:        e.InvoiceID,
			OrderID:          e.OrderID,
			Amount:           json.Number(e.Amount.Decimal()),
			PSPTransactionID: e.PSPTransactionID,
			Reason:           e.Reason,
			FailedAt:         formatTime(e.FailedAt),
		}), nil
	}
	return outbox.IntegrationEvent{}, fmt.Errorf("%w: %s", outbox.ErrUnmappedEvent, event.EventName())
}

func invoiceEvent(eventType string, data any) outbox.IntegrationEvent {
	return outbox.IntegrationEvent{Type: eventType, AggregateType: "invoice", Data: data}
}

func formatTime(at time.Time) string { return at.UTC().Format(time.RFC3339Nano) }
