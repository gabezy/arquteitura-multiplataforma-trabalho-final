package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/shared/domain"
)

func newTestRouter(deps Deps) *Router {
	if deps.Logger == nil {
		deps.Logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	return NewRouter(deps)
}

func do(router *Router, method, target string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	router.Handler().ServeHTTP(rec, httptest.NewRequest(method, target, nil))
	return rec
}

func decode(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response body %q is not JSON: %v", rec.Body.String(), err)
	}
	return body
}

// BOOT-01
func TestHealthRespondsUpWhenTheDatabaseAnswers(t *testing.T) {
	router := newTestRouter(Deps{CheckHealth: func(context.Context) error { return nil }})

	rec := do(router, http.MethodGet, "/health")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); !strings.HasPrefix(got, "application/json") {
		t.Errorf("Content-Type = %q, want application/json", got)
	}
	if body := decode(t, rec); len(body) != 1 || body["status"] != "UP" {
		t.Errorf("body = %v, want {status: UP}", body)
	}
}

// BOOT-02
func TestHealthRespondsDownWhenTheDatabaseFails(t *testing.T) {
	router := newTestRouter(Deps{CheckHealth: func(context.Context) error { return errors.New("connection refused") }})

	rec := do(router, http.MethodGet, "/health")

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
	if body := decode(t, rec); len(body) != 1 || body["status"] != "DOWN" {
		t.Errorf("body = %v, want {status: DOWN}", body)
	}
}

// BOOT-02: a probe that never answers, and ignores its context, still ends in 503.
func TestHealthRespondsDownWhenTheDatabaseDoesNotAnswerInTime(t *testing.T) {
	release := make(chan struct{})
	defer close(release)
	router := newTestRouter(Deps{
		HealthTimeout: 50 * time.Millisecond,
		CheckHealth:   func(context.Context) error { <-release; return nil },
	})

	started := time.Now()
	rec := do(router, http.MethodGet, "/health")

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Fatalf("answered after %v, want it bounded by the 50ms timeout", elapsed)
	}
}

// BOOT-02: the database has 2 s to answer.
func TestHealthGivesTheDatabaseTwoSecondsByDefault(t *testing.T) {
	if DefaultHealthTimeout != 2*time.Second {
		t.Fatalf("DefaultHealthTimeout = %v, want 2s", DefaultHealthTimeout)
	}

	var gotDeadline time.Time
	router := newTestRouter(Deps{CheckHealth: func(ctx context.Context) error {
		gotDeadline, _ = ctx.Deadline()
		return nil
	}})
	before := time.Now()
	do(router, http.MethodGet, "/health")

	if budget := gotDeadline.Sub(before); budget < 1900*time.Millisecond || budget > 2100*time.Millisecond {
		t.Fatalf("the probe context had %v to answer, want about 2s", budget)
	}
}

func TestErrorsBecomeProblemDetails(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantDetail string
		wantIssues []any
	}{
		{"validation error", domain.NewValidationError("quantity must be positive"), 422, "quantity must be positive", nil},
		{"not found error", domain.NewNotFoundError("invoice 7 not found"), 404, "invoice 7 not found", nil},
		{"conflict error", domain.NewConflictError("invoice already paid"), 409, "invoice already paid", nil},
		{"wrapped domain error", fmt.Errorf("get invoice: %w", domain.NewNotFoundError("missing")), 404, "get invoice: missing", nil},
		{"malformed request", &requestError{Message: "limit must be between 1 and 100", Issues: []string{"limit"}}, 400, "limit must be between 1 and 100", []any{"limit"}},
		{"unexpected error", errors.New("connection refused to 10.0.0.5:5432"), 500, "", nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			router := newTestRouter(Deps{})
			router.handle("GET /boom", func(http.ResponseWriter, *http.Request) error { return tt.err })

			rec := do(router, http.MethodGet, "/boom?x=1")

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if got := rec.Header().Get("Content-Type"); got != "application/problem+json" {
				t.Errorf("Content-Type = %q, want application/problem+json", got)
			}
			body := decode(t, rec)
			if body["type"] != "about:blank" || body["title"] != http.StatusText(tt.wantStatus) || body["instance"] != "/boom?x=1" {
				t.Errorf("problem = %v, want type about:blank, title %q, instance /boom?x=1", body, http.StatusText(tt.wantStatus))
			}
			if body["status"] != float64(tt.wantStatus) {
				t.Errorf("problem status = %v, want %d", body["status"], tt.wantStatus)
			}
			if got, _ := body["detail"].(string); got != tt.wantDetail {
				t.Errorf("detail = %q, want %q", got, tt.wantDetail)
			}
			if tt.wantIssues != nil {
				issues, _ := body["errors"].([]any)
				if fmt.Sprint(issues) != fmt.Sprint(tt.wantIssues) {
					t.Errorf("errors = %v, want %v", issues, tt.wantIssues)
				}
			}
		})
	}
}

func TestAnUnexpectedErrorNeverLeaksItsMessage(t *testing.T) {
	router := newTestRouter(Deps{})
	router.handle("GET /boom", func(http.ResponseWriter, *http.Request) error {
		return errors.New("password authentication failed for user billing")
	})

	rec := do(router, http.MethodGet, "/boom")

	if strings.Contains(rec.Body.String(), "password") {
		t.Fatalf("body %q leaks the error message", rec.Body.String())
	}
}
