package model

// Status is where an invoice is in its life.
type Status string

const (
	StatusIssued         Status = "ISSUED"
	StatusPaymentPending Status = "PAYMENT_PENDING"
	StatusPaid           Status = "PAID"
	StatusPaymentFailed  Status = "PAYMENT_FAILED"
	StatusCancelled      Status = "CANCELLED"
)

// IsFinal reports whether the invoice can no longer change by itself.
func (s Status) IsFinal() bool {
	return s == StatusPaid || s == StatusPaymentFailed || s == StatusCancelled
}
