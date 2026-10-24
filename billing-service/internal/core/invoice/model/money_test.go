package model_test

import (
	"errors"
	"testing"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/model"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/shared/domain"
)

func TestParseMoneyReadsDecimalsWithUpToTwoPlaces(t *testing.T) {
	tests := []struct {
		input string
		want  int64
	}{
		{"15000", 1500000},
		{"15000.00", 1500000},
		{"15000.5", 1500050},
		{"0.01", 1},
		{"0.1", 10},
		{"0", 0},
		{"1000000.00", 100000000},
		{"00012.30", 1230},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got, err := model.ParseMoney(tt.input)
			if err != nil {
				t.Fatalf("ParseMoney(%q) error = %v", tt.input, err)
			}
			if got.Cents() != tt.want {
				t.Fatalf("ParseMoney(%q) = %d cents, want %d", tt.input, got.Cents(), tt.want)
			}
		})
	}
}

func TestParseMoneyRejectsWhatIsNotAnAmountInReaisWithCents(t *testing.T) {
	for _, input := range []string{"", " ", "abc", "-1", "+1", "1.234", "1.", ".5", "1e3", "1,5", "1.2.3", "15000.00 "} {
		t.Run(input, func(t *testing.T) {
			_, err := model.ParseMoney(input)

			var validation *domain.ValidationError
			if !errors.As(err, &validation) {
				t.Fatalf("ParseMoney(%q) error = %v, want a ValidationError", input, err)
			}
		})
	}
}

func TestMoneyDecimalWritesTwoPlacesWithoutFloats(t *testing.T) {
	tests := []struct {
		cents int64
		want  string
	}{
		{1500000, "15000.00"},
		{4, "0.04"},
		{0, "0.00"},
		{10, "0.10"},
		{100000000, "1000000.00"},
		{1334999, "13349.99"},
	}
	for _, tt := range tests {
		if got := model.Money(tt.cents).Decimal(); got != tt.want {
			t.Errorf("Money(%d).Decimal() = %q, want %q", tt.cents, got, tt.want)
		}
	}
}

func TestMoneyArithmeticWorksOnCents(t *testing.T) {
	price := model.Money(1500050)

	if got := price.Times(3); got != 4500150 {
		t.Errorf("Times(3) = %d, want 4500150", got)
	}
	if got := price.Add(model.Money(50)); got != 1500100 {
		t.Errorf("Add = %d, want 1500100", got)
	}
	if got := price.Sub(model.Money(50)); got != 1500000 {
		t.Errorf("Sub = %d, want 1500000", got)
	}
}

func TestNewMoneyRejectsNegativeAmounts(t *testing.T) {
	if _, err := model.NewMoney(-1); err == nil {
		t.Fatal("NewMoney(-1) error = nil, want a ValidationError")
	}
	if m, err := model.NewMoney(0); err != nil || m != 0 {
		t.Fatalf("NewMoney(0) = (%d, %v), want (0, nil)", m, err)
	}
}
