package model_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/model"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/shared/domain"
)

func TestNewItemComputesItsAmountAsQuantityTimesUnitPrice(t *testing.T) {
	item, err := model.NewItem("231", 3, model.Money(1500050))
	if err != nil {
		t.Fatal(err)
	}

	if item.Amount() != 4500150 {
		t.Fatalf("Amount() = %d, want 4500150", item.Amount())
	}
	if item.SKU != "231" || item.Quantity != 3 || item.UnitPrice != 1500050 {
		t.Fatalf("item = %+v, want sku 231, quantity 3, unit price 1500050", item)
	}
}

func TestNewItemAcceptsTheLimitsOfTheSpec(t *testing.T) {
	for _, tt := range []struct {
		name     string
		quantity int
		price    model.Money
	}{
		{"smallest quantity and price", 1, 1},
		{"largest quantity", 10000, 1500000},
		{"largest unit price", 1, 100000000},
	} {
		if _, err := model.NewItem("SKU-1", tt.quantity, tt.price); err != nil {
			t.Errorf("%s: NewItem() error = %v", tt.name, err)
		}
	}
}

func TestNewItemRejectsValuesOutOfBounds(t *testing.T) {
	tests := []struct {
		name     string
		sku      string
		quantity int
		price    model.Money
	}{
		{"blank sku", "  ", 1, 100},
		{"empty sku", "", 1, 100},
		{"zero quantity", "SKU-1", 0, 100},
		{"negative quantity", "SKU-1", -1, 100},
		{"quantity above 10000", "SKU-1", 10001, 100},
		{"zero unit price", "SKU-1", 1, 0},
		{"unit price above 1000000.00", "SKU-1", 1, 100000001},
		{"sku longer than 64 characters", strings.Repeat("A", 65), 1, 100},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := model.NewItem(tt.sku, tt.quantity, tt.price)

			var validation *domain.ValidationError
			if !errors.As(err, &validation) {
				t.Fatalf("NewItem() error = %v, want a ValidationError", err)
			}
		})
	}
}
