package messaging

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/google/uuid"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/model"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/shared/domain"
)

// The public types of the order events billing reads (event catalog of #8).
const (
	OrderConfirmedType = "order.order.confirmed.v1"
	OrderCancelledType = "order.order.cancelled.v1"
)

var requiredHeaders = []string{"ce_specversion", "ce_id", "ce_source", "ce_type"}

// orderTopics maps a topic to the event type it must carry.
type orderTopics map[string]string

// number keeps a JSON value as its text, so that money never goes through a
// float. A string keeps its quotes and a boolean its letters, which ParseMoney
// and Atoi reject.
type number string

func (n *number) UnmarshalJSON(raw []byte) error {
	*n = number(raw)
	return nil
}

type confirmedPayload struct {
	OrderID         string `json:"orderId"`
	Marketplace     string `json:"marketplace"`
	ExternalOrderID string `json:"externalOrderId"`
	Items           []struct {
		SKU       string  `json:"sku"`
		Quantity  *number `json:"quantity"`
		UnitPrice *number `json:"unitPrice"`
	} `json:"items"`
	Total *number `json:"total"`
}

type cancelledPayload struct {
	OrderID string `json:"orderId"`
	Reason  string `json:"reason"`
}

// orderEvent is a parsed order event: exactly one of the two fields is set.
type orderEvent struct {
	eventID   string
	eventType string
	confirmed *model.OrderData
	cancelled *cancellation
}

type cancellation struct {
	orderID string
	reason  string
}

// parseOrderEvent checks the CloudEvents headers and the payload of a message
// against the contract. Anything wrong makes the message unprocessable.
func parseOrderEvent(message Message, topics orderTopics) (orderEvent, error) {
	headers := headerValues(message.Headers)
	var missing []string
	for _, name := range requiredHeaders {
		if strings.TrimSpace(headers[name]) == "" {
			missing = append(missing, name)
		}
	}
	if len(missing) > 0 {
		return orderEvent{}, &UnprocessableError{Reason: "missing CloudEvents headers: " + strings.Join(missing, ", ")}
	}

	eventType := headers["ce_type"]
	expected, known := topics[message.Topic]
	if !known || expected != eventType {
		return orderEvent{}, &UnprocessableError{Reason: fmt.Sprintf("unexpected event type %q on topic %q", eventType, message.Topic)}
	}

	event := orderEvent{eventID: headers["ce_id"], eventType: eventType}
	switch eventType {
	case OrderConfirmedType:
		order, err := parseConfirmed(message.Value)
		if err != nil {
			return orderEvent{}, unprocessable(err)
		}
		event.confirmed = &order
	case OrderCancelledType:
		cancelled, err := parseCancelled(message.Value)
		if err != nil {
			return orderEvent{}, unprocessable(err)
		}
		event.cancelled = &cancelled
	}
	return event, nil
}

func parseConfirmed(value []byte) (model.OrderData, error) {
	var payload confirmedPayload
	if err := decode(value, &payload); err != nil {
		return model.OrderData{}, err
	}

	orderID, err := parseUUID("orderId", payload.OrderID)
	if err != nil {
		return model.OrderData{}, err
	}
	marketplace, err := model.ParseMarketplace(payload.Marketplace)
	if err != nil {
		return model.OrderData{}, err
	}

	if len(payload.Items) == 0 {
		return model.OrderData{}, domain.NewValidationError("items must have at least one item")
	}
	items := make([]model.Item, 0, len(payload.Items))
	for _, raw := range payload.Items {
		if raw.Quantity == nil || raw.UnitPrice == nil {
			return model.OrderData{}, domain.NewValidationError("every item needs sku, quantity and unitPrice")
		}
		quantity, err := strconv.Atoi(string(*raw.Quantity))
		if err != nil {
			return model.OrderData{}, domain.NewValidationError("quantity of %s must be an integer", strings.TrimSpace(raw.SKU))
		}
		unitPrice, err := model.ParseMoney(string(*raw.UnitPrice))
		if err != nil {
			return model.OrderData{}, domain.NewValidationError("unitPrice of %s: %s", strings.TrimSpace(raw.SKU), err.Error())
		}
		item, err := model.NewItem(raw.SKU, quantity, unitPrice)
		if err != nil {
			return model.OrderData{}, err
		}
		items = append(items, item)
	}

	if payload.Total == nil {
		return model.OrderData{}, domain.NewValidationError("total is required")
	}
	total, err := model.ParseMoney(string(*payload.Total))
	if err != nil {
		return model.OrderData{}, domain.NewValidationError("total: %s", err.Error())
	}

	return model.OrderData{
		OrderID:         orderID,
		ExternalOrderID: strings.TrimSpace(payload.ExternalOrderID),
		Marketplace:     marketplace,
		Items:           items,
		DeclaredTotal:   total,
	}, nil
}

func parseCancelled(value []byte) (cancellation, error) {
	var payload cancelledPayload
	if err := decode(value, &payload); err != nil {
		return cancellation{}, err
	}
	orderID, err := parseUUID("orderId", payload.OrderID)
	if err != nil {
		return cancellation{}, err
	}
	return cancellation{orderID: orderID, reason: strings.TrimSpace(payload.Reason)}, nil
}

// decode reads one JSON object. Fields the contract does not know are ignored,
// so a producer can add optional fields without breaking the consumer.
func decode(value []byte, into any) error {
	if len(bytes.TrimSpace(value)) == 0 {
		return domain.NewValidationError("message has no value")
	}
	decoder := json.NewDecoder(bytes.NewReader(value))
	if err := decoder.Decode(into); err != nil {
		return domain.NewValidationError("message is not a valid JSON object of the contract: %s", err.Error())
	}
	if decoder.More() {
		return domain.NewValidationError("message has data after the JSON object")
	}
	return nil
}

func parseUUID(field, raw string) (string, error) {
	parsed, err := uuid.Parse(raw)
	if err != nil {
		return "", domain.NewValidationError("%s must be a UUID", field)
	}
	return parsed.String(), nil
}

func unprocessable(err error) error {
	return &UnprocessableError{Reason: err.Error()}
}
