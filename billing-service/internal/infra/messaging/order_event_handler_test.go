package messaging_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"slices"
	"testing"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/model"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/port/in"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/shared/domain"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/messaging"
)

const (
	orderID        = "6f1c2b8e-0000-4000-8000-000000000001"
	confirmedTopic = "order.order.confirmed.v1"
	cancelledTopic = "order.order.cancelled.v1"

	validConfirmed = `{"orderId":"6f1c2b8e-0000-4000-8000-000000000001","marketplace":"MERCADO_LIVRE","externalOrderId":"ML-2000001",` +
		`"items":[{"sku":"231","quantity":2,"unitPrice":15000.50},{"sku":"412","quantity":1,"unitPrice":9000}],` +
		`"total":39001.00,"confirmedAt":"2026-10-28T13:05:02Z"}`
	validCancelled = `{"orderId":"6f1c2b8e-0000-4000-8000-000000000001","reason":"PAYMENT_FAILED"}`
)

func eventHeaders(id, eventType string) []messaging.Header {
	return []messaging.Header{
		{Key: "ce_specversion", Value: []byte("1.0")},
		{Key: "ce_id", Value: []byte(id)},
		{Key: "ce_source", Value: []byte("/order-service")},
		{Key: "ce_type", Value: []byte(eventType)},
		{Key: "ce_subject", Value: []byte(orderID)},
		{Key: "content-type", Value: []byte("application/json")},
	}
}

func confirmedMessage(body string) messaging.Message {
	return messaging.Message{Topic: confirmedTopic, Partition: 1, Offset: 42, Key: []byte(orderID), Value: []byte(body), Headers: eventHeaders("evt-1", confirmedTopic)}
}

func cancelledMessage(body string) messaging.Message {
	return messaging.Message{Topic: cancelledTopic, Key: []byte(orderID), Value: []byte(body), Headers: eventHeaders("evt-2", cancelledTopic)}
}

func without(message messaging.Message, header string) messaging.Message {
	message.Headers = slices.DeleteFunc(slices.Clone(message.Headers), func(h messaging.Header) bool { return h.Key == header })
	return message
}

func withHeader(message messaging.Message, key, value string) messaging.Message {
	headers := slices.Clone(message.Headers)
	for i := range headers {
		if headers[i].Key == key {
			headers[i].Value = []byte(value)
			message.Headers = headers
			return message
		}
	}
	message.Headers = append(headers, messaging.Header{Key: key, Value: []byte(value)})
	return message
}

type fakeFacade struct {
	issued      []model.OrderData
	cancelled   []in.CancelInvoiceCommand
	issueResult error
	cancelError error
}

func (f *fakeFacade) IssueInvoice(_ context.Context, order model.OrderData) (in.IssueOutcome, error) {
	f.issued = append(f.issued, order)
	return in.Issued, f.issueResult
}

func (f *fakeFacade) CancelInvoice(_ context.Context, command in.CancelInvoiceCommand) (in.CancelOutcome, error) {
	f.cancelled = append(f.cancelled, command)
	return in.Cancelled, f.cancelError
}

// fakeInbox remembers the event ids, and forgets the ones marked in a transaction that rolled back.
type fakeInbox struct {
	seen  map[string]string
	error error
}

func newFakeInbox() *fakeInbox { return &fakeInbox{seen: map[string]string{}} }

func (i *fakeInbox) MarkProcessed(_ context.Context, eventID, eventType string) (bool, error) {
	if i.error != nil {
		return false, i.error
	}
	if _, ok := i.seen[eventID]; ok {
		return false, nil
	}
	i.seen[eventID] = eventType
	return true, nil
}

type rollbackTransactor struct {
	inbox *fakeInbox
	opens int
}

func (t *rollbackTransactor) WithinTransaction(ctx context.Context, fn func(ctx context.Context) error) error {
	t.opens++
	before := map[string]string{}
	for key, value := range t.inbox.seen {
		before[key] = value
	}
	if err := fn(ctx); err != nil {
		t.inbox.seen = before
		return err
	}
	return nil
}

type handlerFixture struct {
	handler    *messaging.OrderEventHandler
	facade     *fakeFacade
	inbox      *fakeInbox
	transactor *rollbackTransactor
}

func newHandlerFixture() handlerFixture {
	f := handlerFixture{facade: &fakeFacade{}, inbox: newFakeInbox()}
	f.transactor = &rollbackTransactor{inbox: f.inbox}
	f.handler = messaging.NewOrderEventHandler(f.facade, f.facade, f.inbox, f.transactor, messaging.OrderTopics{Confirmed: confirmedTopic, Cancelled: cancelledTopic},
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	return f
}

func asUnprocessable(err error) (*messaging.UnprocessableError, bool) {
	var unprocessable *messaging.UnprocessableError
	return unprocessable, errors.As(err, &unprocessable)
}

// INV-01: a valid confirmation reaches the facade, with the money read exactly.
func TestHandleSendsAConfirmedOrderToTheFacadeWithExactMoney(t *testing.T) {
	f := newHandlerFixture()

	err := f.handler.Handle(context.Background(), confirmedMessage(validConfirmed))

	if err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	if len(f.facade.issued) != 1 {
		t.Fatalf("IssueInvoice called %d times, want 1", len(f.facade.issued))
	}
	want := model.OrderData{
		OrderID:         orderID,
		ExternalOrderID: "ML-2000001",
		Marketplace:     model.MercadoLivre,
		Items: []model.Item{
			{SKU: "231", Quantity: 2, UnitPrice: 1500050},
			{SKU: "412", Quantity: 1, UnitPrice: 900000},
		},
		DeclaredTotal: 3900100,
	}
	got := f.facade.issued[0]
	if got.OrderID != want.OrderID || got.ExternalOrderID != want.ExternalOrderID || got.Marketplace != want.Marketplace || got.DeclaredTotal != want.DeclaredTotal || !slices.Equal(got.Items, want.Items) {
		t.Fatalf("order sent to the facade = %+v, want %+v", got, want)
	}
	if f.inbox.seen["evt-1"] != confirmedTopic {
		t.Fatalf("inbox = %v, want evt-1 marked as %s", f.inbox.seen, confirmedTopic)
	}
}

func TestHandleAcceptsAConfirmedOrderWithoutTheOptionalFields(t *testing.T) {
	f := newHandlerFixture()
	body := `{"orderId":"6f1c2b8e-0000-4000-8000-000000000001","marketplace":"AMAZON","items":[{"sku":"231","quantity":1,"unitPrice":15000}],"total":15000}`

	if err := f.handler.Handle(context.Background(), confirmedMessage(body)); err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	if got := f.facade.issued[0]; got.ExternalOrderID != "" || got.Marketplace != model.Amazon || got.DeclaredTotal != 1500000 {
		t.Fatalf("order = %+v, want no external id, AMAZON and a total of 1500000", got)
	}
}

// INV-04: an event id that was already processed changes nothing.
func TestHandleIgnoresAnEventThatWasAlreadyProcessed(t *testing.T) {
	f := newHandlerFixture()
	message := confirmedMessage(validConfirmed)
	if err := f.handler.Handle(context.Background(), message); err != nil {
		t.Fatal(err)
	}

	err := f.handler.Handle(context.Background(), message)

	if err != nil || len(f.facade.issued) != 1 {
		t.Fatalf("second Handle() = %v with %d IssueInvoice calls, want nil and 1", err, len(f.facade.issued))
	}
}

// INV-06: whatever breaks the contract can never succeed, so it is unprocessable.
func TestHandleReportsContractViolationsAsUnprocessable(t *testing.T) {
	item := func(sku, quantity, price string) string {
		return `{"orderId":"` + orderID + `","marketplace":"AMAZON","total":15000,"items":[{"sku":` + sku + `,"quantity":` + quantity + `,"unitPrice":` + price + `}]}`
	}
	tests := []struct {
		name    string
		message messaging.Message
	}{
		{"missing ce_specversion", without(confirmedMessage(validConfirmed), "ce_specversion")},
		{"missing ce_id", without(confirmedMessage(validConfirmed), "ce_id")},
		{"missing ce_source", without(confirmedMessage(validConfirmed), "ce_source")},
		{"missing ce_type", without(confirmedMessage(validConfirmed), "ce_type")},
		{"empty ce_id", withHeader(confirmedMessage(validConfirmed), "ce_id", "")},
		{"event type of another topic", withHeader(confirmedMessage(validConfirmed), "ce_type", cancelledTopic)},
		{"unknown event type", withHeader(confirmedMessage(validConfirmed), "ce_type", "order.order.shipped.v1")},
		{"topic that billing does not read", messaging.Message{Topic: "other.topic.v1", Value: []byte(validConfirmed), Headers: eventHeaders("evt-1", confirmedTopic)}},
		{"empty value", confirmedMessage("")},
		{"not JSON", confirmedMessage("{")},
		{"JSON that is not an object", confirmedMessage(`[1]`)},
		{"missing orderId", confirmedMessage(`{"marketplace":"AMAZON","total":15000,"items":[{"sku":"231","quantity":1,"unitPrice":15000}]}`)},
		{"orderId that is not a UUID", confirmedMessage(`{"orderId":"42","marketplace":"AMAZON","total":15000,"items":[{"sku":"231","quantity":1,"unitPrice":15000}]}`)},
		{"unknown marketplace", confirmedMessage(`{"orderId":"` + orderID + `","marketplace":"EBAY","total":15000,"items":[{"sku":"231","quantity":1,"unitPrice":15000}]}`)},
		{"missing items", confirmedMessage(`{"orderId":"` + orderID + `","marketplace":"AMAZON","total":15000}`)},
		{"items that is not an array", confirmedMessage(`{"orderId":"` + orderID + `","marketplace":"AMAZON","total":15000,"items":{}}`)},
		{"blank sku", confirmedMessage(item(`" "`, "1", "15000"))},
		{"quantity zero", confirmedMessage(item(`"231"`, "0", "15000"))},
		{"quantity above 10000", confirmedMessage(item(`"231"`, "10001", "15000"))},
		{"fractional quantity", confirmedMessage(item(`"231"`, "1.5", "15000"))},
		{"quantity in exponent notation", confirmedMessage(item(`"231"`, "1e3", "15000"))},
		{"quantity as a string", confirmedMessage(item(`"231"`, `"1"`, "15000"))},
		{"unit price zero", confirmedMessage(item(`"231"`, "1", "0"))},
		{"unit price above 1000000.00", confirmedMessage(item(`"231"`, "1", "1000000.01"))},
		{"unit price with three decimals", confirmedMessage(item(`"231"`, "1", "10.001"))},
		{"unit price in exponent notation", confirmedMessage(item(`"231"`, "1", "1.5e4"))},
		{"unit price as a string", confirmedMessage(item(`"231"`, "1", `"15000.00"`))},
		{"negative unit price", confirmedMessage(item(`"231"`, "1", "-5"))},
		{"missing total", confirmedMessage(`{"orderId":"` + orderID + `","marketplace":"AMAZON","items":[{"sku":"231","quantity":1,"unitPrice":15000}]}`)},
		{"total as a string", confirmedMessage(`{"orderId":"` + orderID + `","marketplace":"AMAZON","total":"15000","items":[{"sku":"231","quantity":1,"unitPrice":15000}]}`)},
		{"cancelled: missing orderId", cancelledMessage(`{"reason":"OUT_OF_STOCK"}`)},
		{"cancelled: orderId that is not a UUID", cancelledMessage(`{"orderId":"abc"}`)},
		{"cancelled: not JSON", cancelledMessage("not json")},
		{"cancelled: reason that is not a string", cancelledMessage(`{"orderId":"` + orderID + `","reason":7}`)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := newHandlerFixture()

			err := f.handler.Handle(context.Background(), tt.message)

			unprocessable, ok := asUnprocessable(err)
			if !ok || unprocessable.Reason == "" {
				t.Fatalf("Handle() error = %v, want an UnprocessableError with a reason", err)
			}
			if len(f.facade.issued)+len(f.facade.cancelled) != 0 {
				t.Fatal("the facade was called for a message that breaks the contract")
			}
			if len(f.inbox.seen) != 0 {
				t.Fatalf("inbox = %v, want it untouched", f.inbox.seen)
			}
		})
	}
}

// INV-06: a ValidationError of the core is unprocessable too, and the inbox mark rolls back with it.
func TestHandleReportsACoreValidationErrorAsUnprocessableAndForgetsTheEvent(t *testing.T) {
	f := newHandlerFixture()
	f.facade.issueResult = domain.NewValidationError("declared total 1.00 differs from the sum of the items 15000.00")

	err := f.handler.Handle(context.Background(), confirmedMessage(validConfirmed))

	unprocessable, ok := asUnprocessable(err)
	if !ok || unprocessable.Reason != "declared total 1.00 differs from the sum of the items 15000.00" {
		t.Fatalf("Handle() error = %v, want an UnprocessableError with the reason of the core", err)
	}
	if len(f.inbox.seen) != 0 {
		t.Fatalf("inbox = %v, want the event forgotten: it was not processed", f.inbox.seen)
	}
}

// INV-07: anything else is transient, and the event stays unmarked so the redelivery is processed.
func TestHandleReturnsTransientErrorsAndForgetsTheEvent(t *testing.T) {
	for name, failure := range map[string]error{
		"conflict of the unique order key": domain.NewConflictError("order already has an invoice"),
		"database down":                    errors.New("connection refused"),
	} {
		t.Run(name, func(t *testing.T) {
			f := newHandlerFixture()
			f.facade.issueResult = failure

			err := f.handler.Handle(context.Background(), confirmedMessage(validConfirmed))

			if !errors.Is(err, failure) {
				t.Fatalf("Handle() error = %v, want %v", err, failure)
			}
			if _, ok := asUnprocessable(err); ok {
				t.Fatal("a transient failure was reported as unprocessable")
			}
			if len(f.inbox.seen) != 0 {
				t.Fatalf("inbox = %v, want the event forgotten so the retry runs", f.inbox.seen)
			}
		})
	}
}

func TestHandleReturnsAnInboxFailureWithoutCallingTheFacade(t *testing.T) {
	f := newHandlerFixture()
	f.inbox.error = errors.New("inbox unavailable")

	err := f.handler.Handle(context.Background(), confirmedMessage(validConfirmed))

	if !errors.Is(err, f.inbox.error) || len(f.facade.issued) != 0 {
		t.Fatalf("Handle() = %v with %d IssueInvoice calls, want the inbox error and none", err, len(f.facade.issued))
	}
}

// INV-08 and INV-09: a cancellation reaches the facade with its reason.
func TestHandleSendsACancellationToTheFacade(t *testing.T) {
	f := newHandlerFixture()

	if err := f.handler.Handle(context.Background(), cancelledMessage(validCancelled)); err != nil {
		t.Fatalf("Handle() error = %v", err)
	}

	want := in.CancelInvoiceCommand{OrderID: orderID, Reason: "PAYMENT_FAILED"}
	if len(f.facade.cancelled) != 1 || f.facade.cancelled[0] != want {
		t.Fatalf("CancelInvoice calls = %+v, want one with %+v", f.facade.cancelled, want)
	}
	if f.inbox.seen["evt-2"] != cancelledTopic {
		t.Fatalf("inbox = %v, want evt-2 marked as %s", f.inbox.seen, cancelledTopic)
	}
}

func TestHandleAcceptsACancellationWithoutReasonAndWithExtraFields(t *testing.T) {
	f := newHandlerFixture()
	body := `{"orderId":"` + orderID + `","marketplace":"AMAZON","externalOrderId":"AMZ-1"}`

	if err := f.handler.Handle(context.Background(), cancelledMessage(body)); err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	if got := f.facade.cancelled[0]; got.OrderID != orderID || got.Reason != "" {
		t.Fatalf("command = %+v, want the order with no reason", got)
	}
}

func TestHandleDeduplicatesACancellationRedelivery(t *testing.T) {
	f := newHandlerFixture()
	message := cancelledMessage(validCancelled)
	for i := 0; i < 2; i++ {
		if err := f.handler.Handle(context.Background(), message); err != nil {
			t.Fatal(err)
		}
	}
	if len(f.facade.cancelled) != 1 {
		t.Fatalf("CancelInvoice called %d times, want 1", len(f.facade.cancelled))
	}
}

func TestHandleRunsTheFacadeInsideOneTransaction(t *testing.T) {
	f := newHandlerFixture()

	if err := f.handler.Handle(context.Background(), confirmedMessage(validConfirmed)); err != nil {
		t.Fatal(err)
	}

	if f.transactor.opens != 1 {
		t.Fatalf("transactions opened = %d, want 1: the inbox mark and the facade share it", f.transactor.opens)
	}
}
