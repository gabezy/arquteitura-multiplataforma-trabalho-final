package model

import (
	"strings"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/shared/domain"
)

// Bounds of an order, from the spec. They reject absurd orders and keep the
// arithmetic far from overflowing int64.
const (
	MaxItemsPerOrder = 100
	MaxQuantity      = 10_000
	MaxSKULength     = 64
	MinUnitPrice     = Money(1)           // R$ 0,01
	MaxUnitPrice     = Money(100_000_000) // R$ 1.000.000,00
)

// Item is one line of an order.
type Item struct {
	SKU       string
	Quantity  int
	UnitPrice Money
}

// NewItem checks the bounds of a line.
func NewItem(sku string, quantity int, unitPrice Money) (Item, error) {
	sku = strings.TrimSpace(sku)
	switch {
	case sku == "" || len(sku) > MaxSKULength:
		return Item{}, domain.NewValidationError("sku must have 1 to %d characters", MaxSKULength)
	case quantity < 1 || quantity > MaxQuantity:
		return Item{}, domain.NewValidationError("quantity of %s must be between 1 and %d, got %d", sku, MaxQuantity, quantity)
	case unitPrice < MinUnitPrice || unitPrice > MaxUnitPrice:
		return Item{}, domain.NewValidationError("unit price of %s must be between %s and %s, got %s",
			sku, MinUnitPrice.Decimal(), MaxUnitPrice.Decimal(), unitPrice.Decimal())
	}
	return Item{SKU: sku, Quantity: quantity, UnitPrice: unitPrice}, nil
}

// Amount is quantity times unit price.
func (i Item) Amount() Money {
	return i.UnitPrice.Times(i.Quantity)
}
