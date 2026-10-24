// Package domain holds the building blocks shared by every aggregate of the core.
package domain

import "fmt"

// Error is implemented by every error the core raises on purpose. Adapters map
// the concrete category to a status code or to a dead letter, and treat any
// other error as an infrastructure failure.
type Error interface {
	error
	domainError()
}

// ValidationError reports an invalid value or a broken invariant.
type ValidationError struct{ message string }

// NotFoundError reports a lookup that found nothing.
type NotFoundError struct{ message string }

// ConflictError reports a valid operation that clashes with the current state.
type ConflictError struct{ message string }

func NewValidationError(format string, args ...any) *ValidationError {
	return &ValidationError{message: fmt.Sprintf(format, args...)}
}

func NewNotFoundError(format string, args ...any) *NotFoundError {
	return &NotFoundError{message: fmt.Sprintf(format, args...)}
}

func NewConflictError(format string, args ...any) *ConflictError {
	return &ConflictError{message: fmt.Sprintf(format, args...)}
}

func (e *ValidationError) Error() string { return e.message }
func (e *NotFoundError) Error() string   { return e.message }
func (e *ConflictError) Error() string   { return e.message }

func (*ValidationError) domainError() {}
func (*NotFoundError) domainError()   {}
func (*ConflictError) domainError()   {}
