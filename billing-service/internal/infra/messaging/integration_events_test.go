package messaging_test

import (
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/model"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/messaging"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/outbox"
)

const invoiceID = "a3c1d5e2-7b4f-4c8a-9e10-2d3f4a5b6c7d"

func issuedEvent(total, commission, net model.Money, rateBps int, externalOrderID string) model.InvoiceIssued {
	return model.InvoiceIssued{
		InvoiceID:         invoiceID,
		OrderID:           orderID,
		ExternalOrderID:   externalOrderID,
		Marketplace:       model.MercadoLivre,
		Total:             total,
		Commission:        commission,
		Net:               net,
		CommissionRateBps: rateBps,
		IssuedAt:          time.Date(2026, 10, 28, 13, 5, 3, 0, time.UTC),
	}
}

func payloadOf(t *testing.T, event model.InvoiceIssued) string {
	t.Helper()
	mapped, err := messaging.ToIntegrationEvent(event)
	if err != nil {
		t.Fatalf("ToIntegrationEvent() error = %v", err)
	}
	payload, err := json.Marshal(mapped.Data)
	if err != nil {
		t.Fatal(err)
	}
	return string(payload)
}

// INV-03: billing.invoice.issued.v1 as the catalog defines it, money with two decimals.
func TestToIntegrationEventMapsInvoiceIssuedToTheCatalogContract(t *testing.T) {
	mapped, err := messaging.ToIntegrationEvent(issuedEvent(1500000, 165000, 1335000, 1100, "ML-2000001"))

	if err != nil {
		t.Fatal(err)
	}
	if mapped.Type != "billing.invoice.issued.v1" || mapped.AggregateType != "invoice" {
		t.Fatalf("type/aggregate = %q/%q, want billing.invoice.issued.v1/invoice", mapped.Type, mapped.AggregateType)
	}
	want := `{"invoiceId":"a3c1d5e2-7b4f-4c8a-9e10-2d3f4a5b6c7d","orderId":"6f1c2b8e-0000-4000-8000-000000000001",` +
		`"externalOrderId":"ML-2000001","marketplace":"MERCADO_LIVRE","amount":15000.00,"commissionPercent":11.00,` +
		`"commissionAmount":1650.00,"netAmount":13350.00,"issuedAt":"2026-10-28T13:05:03Z"}`
	if got := payloadOf(t, issuedEvent(1500000, 165000, 1335000, 1100, "ML-2000001")); got != want {
		t.Fatalf("payload =\n %s\nwant\n %s", got, want)
	}
}

func TestToIntegrationEventWritesCentsAndRatesWithoutRoundingErrors(t *testing.T) {
	got := payloadOf(t, issuedEvent(1334999, 4, 1334995, 1150, ""))

	want := `{"invoiceId":"a3c1d5e2-7b4f-4c8a-9e10-2d3f4a5b6c7d","orderId":"6f1c2b8e-0000-4000-8000-000000000001",` +
		`"marketplace":"MERCADO_LIVRE","amount":13349.99,"commissionPercent":11.50,"commissionAmount":0.04,` +
		`"netAmount":13349.95,"issuedAt":"2026-10-28T13:05:03Z"}`
	if got != want {
		t.Fatalf("payload =\n %s\nwant\n %s (no external order id: the field is left out)", got, want)
	}
}

func TestToIntegrationEventRejectsAnEventWithoutMapping(t *testing.T) {
	_, err := messaging.ToIntegrationEvent(unknownEvent{})

	if !errors.Is(err, outbox.ErrUnmappedEvent) {
		t.Fatalf("error = %v, want it to wrap ErrUnmappedEvent", err)
	}
}

type unknownEvent struct{}

func (unknownEvent) EventName() string     { return "InvoiceRenamed" }
func (unknownEvent) AggregateID() string   { return invoiceID }
func (unknownEvent) OccurredAt() time.Time { return time.Time{} }
