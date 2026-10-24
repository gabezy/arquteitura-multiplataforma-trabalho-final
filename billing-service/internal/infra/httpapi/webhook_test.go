package httpapi

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/port/in"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/shared/domain"
)

const webhookSecret = "psp-demo-token"

const (
	paidBody = `{"chargeId":"ch_paid_` + testInvoiceID + `","reference":"` + testInvoiceID + `","status":"PAID",` +
		`"failureReason":null,"occurredAt":"2026-10-28T13:05:06Z"}`
	failedBody = `{"chargeId":"ch_failed_` + testInvoiceID + `","reference":"` + testInvoiceID + `","status":"FAILED",` +
		`"failureReason":"INSUFFICIENT_FUNDS","occurredAt":"2026-10-28T13:10:06Z"}`
)

type fakePayments struct {
	results []in.PaymentResult
	changed bool
	err     error
}

func (f *fakePayments) ApplyPaymentResult(_ context.Context, result in.PaymentResult) (bool, error) {
	f.results = append(f.results, result)
	return f.changed, f.err
}

// logBuffer collects what the router logs, as text with the level.
type logBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (l *logBuffer) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.buf.Write(p)
}

func (l *logBuffer) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.buf.String()
}

func webhookRouter(f *fakePayments) (*Router, *logBuffer) {
	logs := &logBuffer{}
	return newTestRouter(Deps{
		Payments:     f,
		WebhookToken: webhookSecret,
		Logger:       slog.New(slog.NewTextHandler(logs, nil)),
	}), logs
}

// postWebhook sends the body with the token when one is given; no token means no header at all.
func postWebhook(router *Router, body string, token ...string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/webhooks/psp", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if len(token) > 0 {
		req.Header.Set("X-PSP-Token", token[0])
	}
	rec := httptest.NewRecorder()
	router.Handler().ServeHTTP(rec, req)
	return rec
}

// PAY-03: a paid report reaches the use case with the invoice, the charge and the time the PSP gave.
func TestWebhookAppliesAPaidResult(t *testing.T) {
	f := &fakePayments{changed: true}
	router, _ := webhookRouter(f)

	rec := postWebhook(router, paidBody, webhookSecret)

	if rec.Code != http.StatusNoContent || rec.Body.Len() != 0 {
		t.Fatalf("response = %d %q, want 204 without a body", rec.Code, rec.Body)
	}
	want := []in.PaymentResult{{
		InvoiceID:  testInvoiceID,
		ChargeID:   "ch_paid_" + testInvoiceID,
		Status:     in.PaymentPaid,
		OccurredAt: time.Date(2026, 10, 28, 13, 5, 6, 0, time.UTC),
	}}
	if !reflect.DeepEqual(f.results, want) {
		t.Fatalf("the use case received %+v, want %+v", f.results, want)
	}
}

// PAY-04: a failed report carries the reason of the PSP.
func TestWebhookAppliesAFailedResultWithTheReasonOfThePSP(t *testing.T) {
	f := &fakePayments{changed: true}
	router, _ := webhookRouter(f)

	rec := postWebhook(router, failedBody, webhookSecret)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204: %s", rec.Code, rec.Body)
	}
	want := []in.PaymentResult{{
		InvoiceID:     testInvoiceID,
		ChargeID:      "ch_failed_" + testInvoiceID,
		Status:        in.PaymentFailed,
		FailureReason: "INSUFFICIENT_FUNDS",
		OccurredAt:    time.Date(2026, 10, 28, 13, 10, 6, 0, time.UTC),
	}}
	if !reflect.DeepEqual(f.results, want) {
		t.Fatalf("the use case received %+v, want %+v", f.results, want)
	}
}

func TestWebhookWithoutOccurredAtLeavesTheTimeToTheUseCase(t *testing.T) {
	for name, body := range map[string]string{
		"absent": `{"chargeId":"ch_x","reference":"` + testInvoiceID + `","status":"PAID"}`,
		"null":   `{"chargeId":"ch_x","reference":"` + testInvoiceID + `","status":"PAID","occurredAt":null}`,
	} {
		t.Run(name, func(t *testing.T) {
			f := &fakePayments{}
			router, _ := webhookRouter(f)

			rec := postWebhook(router, body, webhookSecret)

			if rec.Code != http.StatusNoContent || len(f.results) != 1 || !f.results[0].OccurredAt.IsZero() {
				t.Fatalf("response %d with results %+v, want 204 and a zero time", rec.Code, f.results)
			}
		})
	}
}

// PAY-06: nobody without the token gets to change an invoice.
func TestWebhookRejectsAMissingOrWrongTokenWithoutCallingTheUseCase(t *testing.T) {
	tests := []struct {
		name  string
		token []string
	}{
		{"no header", nil},
		{"an empty token", []string{""}},
		{"another token", []string{"another-token"}},
		{"the start of the token", []string{"psp-demo"}},
		{"the token with more at the end", []string{webhookSecret + "-x"}},
		{"the token in another case", []string{strings.ToUpper(webhookSecret)}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := &fakePayments{}
			router, logs := webhookRouter(f)

			rec := postWebhook(router, paidBody, tt.token...)

			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want 401: %s", rec.Code, rec.Body)
			}
			if got := rec.Header().Get("Content-Type"); got != "application/problem+json" {
				t.Errorf("Content-Type = %q, want application/problem+json", got)
			}
			if _, leaked := decode(t, rec)["detail"]; leaked {
				t.Errorf("the problem %s explains why the token was refused", rec.Body)
			}
			if len(f.results) != 0 {
				t.Errorf("the use case was called with %+v without a valid token", f.results)
			}
			if !strings.Contains(logs.String(), "level=WARN") {
				t.Errorf("log %q has no warning for the rejected webhook", logs.String())
			}
		})
	}
}

func TestWebhookWithoutAConfiguredTokenRejectsEveryone(t *testing.T) {
	f := &fakePayments{}
	router := newTestRouter(Deps{Payments: f, WebhookToken: ""})

	for _, token := range [][]string{nil, {""}, {"anything"}} {
		if rec := postWebhook(router, paidBody, token...); rec.Code != http.StatusUnauthorized {
			t.Errorf("with header %q: status = %d, want 401", token, rec.Code)
		}
	}
	if len(f.results) != 0 {
		t.Errorf("the use case was called with %+v", f.results)
	}
}

// PAY-07: the same outcome again is a 204, and the log tells it from a change.
func TestWebhookRespondsNoContentForARepeatedResult(t *testing.T) {
	tests := []struct {
		name    string
		changed bool
		want    string
	}{
		{"a change", true, "payment result applied"},
		{"a repeat", false, "payment result repeated, nothing changed"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := &fakePayments{changed: tt.changed}
			router, logs := webhookRouter(f)

			rec := postWebhook(router, paidBody, webhookSecret)

			if rec.Code != http.StatusNoContent {
				t.Fatalf("status = %d, want 204", rec.Code)
			}
			if !strings.Contains(logs.String(), tt.want) {
				t.Errorf("log %q does not say %q", logs.String(), tt.want)
			}
		})
	}
}

// Edge case: a body that is not valid JSON or misses a field is a 400 that names the fields.
func TestWebhookRejectsInvalidBodiesAndNamesTheFields(t *testing.T) {
	const id = testInvoiceID
	tests := []struct {
		name   string
		body   string
		issues []string
	}{
		{"an empty body", ``, []string{"body"}},
		{"text", `paid`, []string{"body"}},
		{"an array", `[]`, []string{"body"}},
		{"data after the object", paidBody + ` {"extra":true}`, []string{"body"}},
		{"a body over the limit", `{"chargeId":"` + strings.Repeat("a", 70<<10) + `"}`, []string{"body"}},
		{"an empty object", `{}`, []string{"chargeId", "reference", "status"}},
		{"no charge id", `{"reference":"` + id + `","status":"PAID"}`, []string{"chargeId"}},
		{"a blank charge id", `{"chargeId":"  ","reference":"` + id + `","status":"PAID"}`, []string{"chargeId"}},
		{"no reference", `{"chargeId":"ch_x","status":"PAID"}`, []string{"reference"}},
		{"a reference that is not an invoice id", `{"chargeId":"ch_x","reference":"42","status":"PAID"}`, []string{"reference"}},
		{"no status", `{"chargeId":"ch_x","reference":"` + id + `"}`, []string{"status"}},
		{"a pending status", `{"chargeId":"ch_x","reference":"` + id + `","status":"PENDING"}`, []string{"status"}},
		{"a status in lower case", `{"chargeId":"ch_x","reference":"` + id + `","status":"paid"}`, []string{"status"}},
		{"a time that is not a time", `{"chargeId":"ch_x","reference":"` + id + `","status":"PAID","occurredAt":"yesterday"}`, []string{"occurredAt"}},
		{"everything wrong at once", `{"chargeId":"","reference":"x","status":"?","occurredAt":"x"}`, []string{"chargeId", "reference", "status", "occurredAt"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := &fakePayments{}
			router, _ := webhookRouter(f)

			rec := postWebhook(router, tt.body, webhookSecret)

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400: %.200s", rec.Code, rec.Body)
			}
			if got := rec.Header().Get("Content-Type"); got != "application/problem+json" {
				t.Errorf("Content-Type = %q, want application/problem+json", got)
			}
			var issues []string
			for _, issue := range decode(t, rec)["errors"].([]any) {
				issues = append(issues, issue.(string))
			}
			if !reflect.DeepEqual(issues, tt.issues) {
				t.Errorf("errors = %v, want %v", issues, tt.issues)
			}
			if len(f.results) != 0 {
				t.Errorf("the use case was called with %+v for an invalid body", f.results)
			}
		})
	}
}

func TestWebhookChecksTheTokenBeforeReadingTheBody(t *testing.T) {
	f := &fakePayments{}
	router, _ := webhookRouter(f)

	if rec := postWebhook(router, `not json`, "wrong"); rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 and not 400: a caller without the token learns nothing about the body", rec.Code)
	}
}

// Edge case: a webhook about an unknown invoice.
func TestWebhookRespondsNotFoundForAnUnknownInvoice(t *testing.T) {
	f := &fakePayments{err: domain.NewNotFoundError("invoice %s not found", testInvoiceID)}
	router, _ := webhookRouter(f)

	rec := postWebhook(router, paidBody, webhookSecret)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404: %s", rec.Code, rec.Body)
	}
	if body := decode(t, rec); body["detail"] != "invoice "+testInvoiceID+" not found" {
		t.Errorf("problem = %v, want the not found detail", body)
	}
}

// PAY-08: a report that contradicts the invoice is a 409 and an error in the log.
func TestWebhookRespondsConflictAndLogsAnErrorForAContradiction(t *testing.T) {
	f := &fakePayments{err: domain.NewConflictError("invoice %s is already PAID, the PSP reports FAILED", testInvoiceID)}
	router, logs := webhookRouter(f)

	rec := postWebhook(router, failedBody, webhookSecret)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409: %s", rec.Code, rec.Body)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/problem+json" {
		t.Errorf("Content-Type = %q, want application/problem+json", got)
	}
	if !strings.Contains(logs.String(), "level=ERROR") || !strings.Contains(logs.String(), "is already PAID") {
		t.Errorf("log %q has no error with the contradiction", logs.String())
	}
}

func TestWebhookRespondsInternalErrorWithoutTheDetailsOfAnUnexpectedFailure(t *testing.T) {
	f := &fakePayments{err: errors.New("connection to billing-db refused")}
	router, logs := webhookRouter(f)

	rec := postWebhook(router, paidBody, webhookSecret)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "billing-db") {
		t.Errorf("the response %s leaks the cause", rec.Body)
	}
	if !strings.Contains(logs.String(), "connection to billing-db refused") {
		t.Errorf("log %q does not keep the cause", logs.String())
	}
}

func TestWebhookIsNotRegisteredWithoutPayments(t *testing.T) {
	router := newTestRouter(Deps{WebhookToken: webhookSecret})

	if rec := postWebhook(router, paidBody, webhookSecret); rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestOnlyPostReachesTheWebhook(t *testing.T) {
	router, _ := webhookRouter(&fakePayments{})

	req := httptest.NewRequest(http.MethodGet, "/webhooks/psp", nil)
	req.Header.Set("X-PSP-Token", webhookSecret)
	rec := httptest.NewRecorder()
	router.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", rec.Code)
	}
}
