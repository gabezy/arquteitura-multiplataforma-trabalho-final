package model_test

import (
	"errors"
	"testing"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/model"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/shared/domain"
)

// INV-02: commission = total x rate, rounded half-up to the cent.
func TestPercentageCommissionRoundsHalfUpToTheCent(t *testing.T) {
	tests := []struct {
		name      string
		rateBps   int
		total     model.Money
		wantCents int64
	}{
		{"11% of R$ 15000.00", 1100, 1500000, 165000},
		{"12% of R$ 9000.00", 1200, 900000, 108000},
		{"14% of R$ 0.25 is 3.5 cents and rounds up to 4", 1400, 25, 4},
		{"14% of R$ 0.03 is 0.42 cents and rounds down to 0", 1400, 3, 0},
		{"11% of R$ 0.05 is 0.55 cents and rounds up to 1", 1100, 5, 1},
		{"12% of R$ 0.04 is 0.48 cents and rounds down to 0", 1200, 4, 0},
		{"11.5% of R$ 100.00", 1150, 10000, 1150},
		{"0% commission", 0, 1500000, 0},
		{"100% commission", 10000, 1500000, 1500000},
		{"rate on the largest possible order stays exact", 1400, 100 * 10000 * 100000000, 14000000000000},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			policy, err := model.NewPercentageCommission(tt.rateBps)
			if err != nil {
				t.Fatal(err)
			}

			if got := policy.Commission(tt.total); got.Cents() != tt.wantCents {
				t.Fatalf("Commission(%d) = %d cents, want %d", tt.total, got.Cents(), tt.wantCents)
			}
			if policy.RateBps() != tt.rateBps {
				t.Fatalf("RateBps() = %d, want %d", policy.RateBps(), tt.rateBps)
			}
		})
	}
}

func TestNewPercentageCommissionRejectsRatesOutsideZeroToOneHundredPercent(t *testing.T) {
	for _, bps := range []int{-1, 10001, 100000} {
		_, err := model.NewPercentageCommission(bps)

		var validation *domain.ValidationError
		if !errors.As(err, &validation) {
			t.Errorf("NewPercentageCommission(%d) error = %v, want a ValidationError", bps, err)
		}
	}
}

func TestCommissionPoliciesPickTheRateOfTheMarketplace(t *testing.T) {
	amazon, _ := model.NewPercentageCommission(1200)
	mercadoLivre, _ := model.NewPercentageCommission(1100)
	policies := model.CommissionPolicies{model.Amazon: amazon, model.MercadoLivre: mercadoLivre}

	got, err := policies.For(model.MercadoLivre)
	if err != nil || got.RateBps() != 1100 {
		t.Fatalf("For(MERCADO_LIVRE) = (%v, %v), want the 11%% policy", got, err)
	}

	_, err = policies.For(model.Shopee)
	var validation *domain.ValidationError
	if !errors.As(err, &validation) {
		t.Fatalf("For(SHOPEE) without a policy: error = %v, want a ValidationError", err)
	}
}

func TestPercentDecimalWritesTheRateWithTwoPlaces(t *testing.T) {
	for bps, want := range map[int]string{1100: "11.00", 1400: "14.00", 1150: "11.50", 5: "0.05", 0: "0.00", 10000: "100.00"} {
		if got := model.PercentDecimal(bps); got != want {
			t.Errorf("PercentDecimal(%d) = %q, want %q", bps, got, want)
		}
	}
}
