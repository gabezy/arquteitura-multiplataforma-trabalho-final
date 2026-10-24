package model

// InvoiceQuery filters and pages a list of invoices. A zero field means "any".
type InvoiceQuery struct {
	OrderID     string
	Status      Status
	Marketplace Marketplace
	Limit       int
	Offset      int
}
