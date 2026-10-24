package messaging

import (
	"context"
	"errors"
	"log/slog"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/port/in"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/port/out"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/shared/domain"
)

// Inbox remembers the ids of the events already processed.
type Inbox interface {
	// MarkProcessed records the event id and reports whether it was new.
	MarkProcessed(ctx context.Context, eventID, eventType string) (bool, error)
}

// OrderTopics are the topics of the two order events billing reads.
type OrderTopics struct {
	Confirmed string
	Cancelled string
}

// OrderEventHandler turns an order event into a call to the invoice use cases.
// It is the driving adapter of the Kafka messages: it validates the message,
// skips redeliveries and keeps the inbox mark and the use case in one transaction.
type OrderEventHandler struct {
	issue      in.IssueInvoiceUseCase
	cancel     in.CancelInvoiceUseCase
	inbox      Inbox
	transactor out.Transactor
	topics     orderTopics
	logger     *slog.Logger
}

func NewOrderEventHandler(
	issue in.IssueInvoiceUseCase,
	cancel in.CancelInvoiceUseCase,
	inbox Inbox,
	transactor out.Transactor,
	topics OrderTopics,
	logger *slog.Logger,
) *OrderEventHandler {
	return &OrderEventHandler{
		issue:      issue,
		cancel:     cancel,
		inbox:      inbox,
		transactor: transactor,
		topics:     orderTopics{topics.Confirmed: OrderConfirmedType, topics.Cancelled: OrderCancelledType},
		logger:     logger,
	}
}

// Handle processes one message. It returns nil when the message was processed or
// was a redelivery, an *UnprocessableError when it can never succeed, and any
// other error when the failure is transient and the message must be handled again.
func (h *OrderEventHandler) Handle(ctx context.Context, message Message) error {
	event, err := parseOrderEvent(message, h.topics)
	if err != nil {
		return err
	}

	var outcome string
	duplicate := false
	err = h.transactor.WithinTransaction(ctx, func(ctx context.Context) error {
		first, err := h.inbox.MarkProcessed(ctx, event.eventID, event.eventType)
		if err != nil {
			return err
		}
		if !first {
			duplicate = true
			return nil
		}

		switch {
		case event.confirmed != nil:
			result, err := h.issue.IssueInvoice(ctx, *event.confirmed)
			outcome = string(result)
			return err
		default:
			result, err := h.cancel.CancelInvoice(ctx, in.CancelInvoiceCommand{OrderID: event.cancelled.orderID, Reason: event.cancelled.reason})
			outcome = string(result)
			return err
		}
	})

	// The transaction rolled back, so the event is not marked: a ValidationError of the
	// core can never succeed, and anything else is tried again.
	var validation *domain.ValidationError
	if errors.As(err, &validation) {
		return &UnprocessableError{Reason: validation.Error()}
	}
	if err != nil {
		return err
	}

	if duplicate {
		h.logger.InfoContext(ctx, "order event already processed", "eventId", event.eventID, "type", event.eventType)
		return nil
	}
	if outcome == string(in.KeptPaid) {
		// The customer paid and the order was cancelled afterwards: there is no refund, so somebody has to know.
		h.logger.WarnContext(ctx, "order cancelled after its invoice was paid: the invoice stays paid, there is no refund",
			"eventId", event.eventID, "orderId", event.cancelled.orderID, "reason", event.cancelled.reason)
		return nil
	}
	h.logger.InfoContext(ctx, "order event processed", "eventId", event.eventID, "type", event.eventType, "outcome", outcome)
	return nil
}
