package messaging

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/model"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/shared/domain"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/outbox"
)

// InvoiceIssuedType is the public type, and the topic, of the event of a new invoice.
const InvoiceIssuedType = "billing.invoice.issued.v1"

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

// ToIntegrationEvent maps a domain event to the integration event the outbox
// stores. An event without a mapping must not leave the service.
func ToIntegrationEvent(event domain.DomainEvent) (outbox.IntegrationEvent, error) {
	switch e := event.(type) {
	case model.InvoiceIssued:
		return outbox.IntegrationEvent{
			Type:          InvoiceIssuedType,
			AggregateType: "invoice",
			Data: invoiceIssuedData{
				InvoiceID:         e.InvoiceID,
				OrderID:           e.OrderID,
				ExternalOrderID:   e.ExternalOrderID,
				Marketplace:       string(e.Marketplace),
				Amount:            json.Number(e.Total.Decimal()),
				CommissionPercent: json.Number(model.PercentDecimal(e.CommissionRateBps)),
				CommissionAmount:  json.Number(e.Commission.Decimal()),
				NetAmount:         json.Number(e.Net.Decimal()),
				IssuedAt:          e.IssuedAt.UTC().Format(time.RFC3339Nano),
			},
		}, nil
	}
	return outbox.IntegrationEvent{}, fmt.Errorf("%w: %s", outbox.ErrUnmappedEvent, event.EventName())
}
