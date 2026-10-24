package domain_test

import (
	"errors"
	"fmt"
	"testing"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/shared/domain"
)

func TestErrorCategoriesKeepTheirMessage(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want string
	}{
		{"validation", domain.NewValidationError("quantity must be positive, got %d", -1), "quantity must be positive, got -1"},
		{"not found", domain.NewNotFoundError("invoice %s not found", "abc"), "invoice abc not found"},
		{"conflict", domain.NewConflictError("invoice already paid"), "invoice already paid"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.err.Error(); got != tt.want {
				t.Fatalf("Error() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestErrorsAsFindsEachCategoryThroughWrapping(t *testing.T) {
	validation := fmt.Errorf("issue invoice: %w", domain.NewValidationError("bad"))
	notFound := fmt.Errorf("get invoice: %w", domain.NewNotFoundError("missing"))
	conflict := fmt.Errorf("apply payment: %w", domain.NewConflictError("clash"))

	var v *domain.ValidationError
	var n *domain.NotFoundError
	var c *domain.ConflictError

	if !errors.As(validation, &v) || errors.As(validation, &n) || errors.As(validation, &c) {
		t.Fatal("a wrapped ValidationError must match only the ValidationError category")
	}
	if !errors.As(notFound, &n) || errors.As(notFound, &v) || errors.As(notFound, &c) {
		t.Fatal("a wrapped NotFoundError must match only the NotFoundError category")
	}
	if !errors.As(conflict, &c) || errors.As(conflict, &v) || errors.As(conflict, &n) {
		t.Fatal("a wrapped ConflictError must match only the ConflictError category")
	}
}

func TestAnyDomainErrorIsRecognisedAndPlainErrorsAreNot(t *testing.T) {
	for _, err := range []error{
		domain.NewValidationError("a"),
		domain.NewNotFoundError("b"),
		fmt.Errorf("wrapped: %w", domain.NewConflictError("c")),
	} {
		var de domain.Error
		if !errors.As(err, &de) {
			t.Fatalf("%v should be a domain.Error", err)
		}
	}

	var de domain.Error
	if errors.As(errors.New("connection refused"), &de) {
		t.Fatal("an infrastructure error must not be a domain.Error")
	}
}
