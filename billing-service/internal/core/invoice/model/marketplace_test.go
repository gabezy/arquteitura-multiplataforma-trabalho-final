package model_test

import (
	"errors"
	"testing"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/model"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/shared/domain"
)

func TestParseMarketplaceAcceptsTheThreeMarketplacesOfTheC4Model(t *testing.T) {
	for input, want := range map[string]model.Marketplace{
		"AMAZON":        model.Amazon,
		"MERCADO_LIVRE": model.MercadoLivre,
		"SHOPEE":        model.Shopee,
	} {
		got, err := model.ParseMarketplace(input)
		if err != nil || got != want {
			t.Errorf("ParseMarketplace(%q) = (%q, %v), want (%q, nil)", input, got, err, want)
		}
	}
}

func TestParseMarketplaceRejectsUnknownValuesAndOtherSpellings(t *testing.T) {
	for _, input := range []string{"", "ebay", "amazon", "Mercado Livre", "MERCADO-LIVRE", " SHOPEE"} {
		_, err := model.ParseMarketplace(input)

		var validation *domain.ValidationError
		if !errors.As(err, &validation) {
			t.Errorf("ParseMarketplace(%q) error = %v, want a ValidationError", input, err)
		}
	}
}
