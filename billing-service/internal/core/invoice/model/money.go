// Package model holds the Invoice aggregate and the value objects it is made of.
package model

import (
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/shared/domain"
)

// Money is an amount in cents of the real. It is never negative: the
// constructors reject a negative value, and the arithmetic stays on integers so
// no float ever touches an amount.
type Money int64

// NewMoney checks that cents is not negative.
func NewMoney(cents int64) (Money, error) {
	if cents < 0 {
		return 0, domain.NewValidationError("amount must not be negative, got %d cents", cents)
	}
	return Money(cents), nil
}

// ParseMoney reads an amount in reais such as "15000", "15000.5" or "15000.00",
// with at most two decimal places and nothing else (no sign, no exponent).
func ParseMoney(decimal string) (Money, error) {
	whole, fraction, hasFraction := strings.Cut(decimal, ".")
	if !isDigits(whole) || (hasFraction && (len(fraction) > 2 || !isDigits(fraction))) {
		return 0, domain.NewValidationError("amount must be a decimal with at most two places, such as 15000.00")
	}

	reais, err := strconv.ParseInt(whole, 10, 64)
	if err != nil || reais > (math.MaxInt64-99)/100 {
		return 0, domain.NewValidationError("amount is too large")
	}

	cents := int64(0)
	if hasFraction {
		cents, _ = strconv.ParseInt((fraction + "0")[:2], 10, 64)
	}
	return Money(reais*100 + cents), nil
}

func isDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func (m Money) Cents() int64 { return int64(m) }

func (m Money) Add(other Money) Money { return m + other }

func (m Money) Sub(other Money) Money { return m - other }

func (m Money) Times(quantity int) Money { return m * Money(quantity) }

// Decimal writes the amount in reais with two places, such as "15000.00".
func (m Money) Decimal() string {
	return fmt.Sprintf("%d.%02d", int64(m)/100, int64(m)%100)
}
