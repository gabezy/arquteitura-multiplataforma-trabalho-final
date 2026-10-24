package model

import "github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/shared/domain"

// Marketplace is a sales channel of the C4 model.
type Marketplace string

const (
	Amazon       Marketplace = "AMAZON"
	MercadoLivre Marketplace = "MERCADO_LIVRE"
	Shopee       Marketplace = "SHOPEE"
)

// ParseMarketplace accepts exactly the three values of the event catalog.
func ParseMarketplace(raw string) (Marketplace, error) {
	switch marketplace := Marketplace(raw); marketplace {
	case Amazon, MercadoLivre, Shopee:
		return marketplace, nil
	}
	return "", domain.NewValidationError("unknown marketplace %q: expected AMAZON, MERCADO_LIVRE or SHOPEE", raw)
}
