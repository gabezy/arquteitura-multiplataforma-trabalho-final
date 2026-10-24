package model

import "github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/shared/domain"

const basisPointsInTotal = 10_000

// CommissionPolicy decides how much of an order the Omni Market keeps.
type CommissionPolicy interface {
	// RateBps is the rate in basis points: 1100 is 11%.
	RateBps() int
	Commission(total Money) Money
}

// PercentageCommission keeps a fixed percentage of the total.
type PercentageCommission struct {
	rateBps int
}

// NewPercentageCommission accepts rates from 0% to 100%, in basis points.
func NewPercentageCommission(rateBps int) (PercentageCommission, error) {
	if rateBps < 0 || rateBps > basisPointsInTotal {
		return PercentageCommission{}, domain.NewValidationError("commission rate must be between 0 and %d basis points, got %d", basisPointsInTotal, rateBps)
	}
	return PercentageCommission{rateBps: rateBps}, nil
}

func (p PercentageCommission) RateBps() int { return p.rateBps }

// Commission is total times rate, rounded half-up to the cent.
func (p PercentageCommission) Commission(total Money) Money {
	return Money((int64(total)*int64(p.rateBps) + basisPointsInTotal/2) / basisPointsInTotal)
}

// CommissionPolicies picks the policy of each marketplace (Strategy).
type CommissionPolicies map[Marketplace]CommissionPolicy

func (p CommissionPolicies) For(marketplace Marketplace) (CommissionPolicy, error) {
	policy, ok := p[marketplace]
	if !ok {
		return nil, domain.NewValidationError("no commission policy for marketplace %q", marketplace)
	}
	return policy, nil
}
