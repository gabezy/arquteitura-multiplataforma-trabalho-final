package psp_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"reflect"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/model"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/port/out"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/psp"
)

const (
	invoiceID   = "5d1f0c1e-7a41-4b8e-9d0a-1f3c2b4a5e60"
	callbackURL = "http://billing-service:8086/webhooks/psp"
)

type received struct {
	method         string
	requestURI     string
	idempotencyKey string
	contentType    string
	traceparent    string
	body           []byte
}

// fakePSP answers every request with the given function and records what it received.
type fakePSP struct {
	server *httptest.Server
	hits   atomic.Int32
	mu     sync.Mutex
	got    []received
}

func newFakePSP(t *testing.T, answer func(w http.ResponseWriter, hit int)) *fakePSP {
	t.Helper()
	f := &fakePSP{}
	f.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		f.mu.Lock()
		f.got = append(f.got, received{
			method:         r.Method,
			requestURI:     r.RequestURI,
			idempotencyKey: r.Header.Get("Idempotency-Key"),
			contentType:    r.Header.Get("Content-Type"),
			traceparent:    r.Header.Get("traceparent"),
			body:           body,
		})
		f.mu.Unlock()
		answer(w, int(f.hits.Add(1)))
	}))
	t.Cleanup(f.server.Close)
	return f
}

func (f *fakePSP) request(i int) received {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.got[i]
}

func reply(w http.ResponseWriter, status int, body string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = io.WriteString(w, body)
}

func always(status int, body string) func(http.ResponseWriter, int) {
	return func(w http.ResponseWriter, _ int) { reply(w, status, body) }
}

const createdBody = `{"id":"ch_paid_` + invoiceID + `","reference":"` + invoiceID + `","status":"PENDING"}`

// fastConfig keeps the shape of the spec with waits short enough for a test.
func fastConfig(baseURL string) psp.Config {
	return psp.Config{
		BaseURL:         baseURL,
		CallbackURL:     callbackURL,
		Timeout:         5 * time.Second,
		Attempts:        3,
		Backoffs:        []time.Duration{time.Millisecond, 2 * time.Millisecond},
		BreakerFailures: 5,
		BreakerOpenFor:  time.Minute,
	}
}

func newClient(config psp.Config) *psp.Client {
	return psp.NewClient(config, slog.New(slog.NewTextHandler(io.Discard, nil)))
}

func chargeRequest(t *testing.T) out.ChargeRequest {
	t.Helper()
	amount, err := model.ParseMoney("15000.00")
	if err != nil {
		t.Fatal(err)
	}
	return out.ChargeRequest{InvoiceID: invoiceID, Amount: amount, Description: "Pedido 7b1c (MERCADO_LIVRE)"}
}

// PAY-09 and PAY-11: the numbers of the spec are the defaults.
func TestDefaultConfigFollowsTheSpec(t *testing.T) {
	got := psp.DefaultConfig("http://psp", callbackURL)

	if got.BaseURL != "http://psp" || got.CallbackURL != callbackURL {
		t.Errorf("urls = %q and %q, want the ones given", got.BaseURL, got.CallbackURL)
	}
	if got.Timeout != 3*time.Second {
		t.Errorf("Timeout = %v, want 3s", got.Timeout)
	}
	if got.Attempts != 3 {
		t.Errorf("Attempts = %d, want 3", got.Attempts)
	}
	if want := []time.Duration{200 * time.Millisecond, 400 * time.Millisecond}; !slices.Equal(got.Backoffs, want) {
		t.Errorf("Backoffs = %v, want %v, growing exponentially", got.Backoffs, want)
	}
	if got.BreakerFailures != 5 {
		t.Errorf("BreakerFailures = %d, want 5", got.BreakerFailures)
	}
	if got.BreakerOpenFor != 30*time.Second {
		t.Errorf("BreakerOpenFor = %v, want 30s", got.BreakerOpenFor)
	}
}

// PAY-02: the charge goes to the PSP as the contract says, and its id comes back.
func TestCreateChargeSendsTheChargeAndReturnsItsID(t *testing.T) {
	fake := newFakePSP(t, always(http.StatusCreated, createdBody))

	created, err := newClient(fastConfig(fake.server.URL+"/")).CreateCharge(context.Background(), chargeRequest(t))

	if err != nil {
		t.Fatalf("CreateCharge() error = %v", err)
	}
	if created.ID != "ch_paid_"+invoiceID {
		t.Errorf("charge id = %q, want ch_paid_%s", created.ID, invoiceID)
	}
	if fake.hits.Load() != 1 {
		t.Fatalf("the PSP received %d requests, want 1", fake.hits.Load())
	}
	got := fake.request(0)
	if got.method != http.MethodPost || got.requestURI != "/psp/v1/charges" {
		t.Errorf("request = %s %s, want POST /psp/v1/charges", got.method, got.requestURI)
	}
	if got.idempotencyKey != invoiceID {
		t.Errorf("Idempotency-Key = %q, want the invoice id %s", got.idempotencyKey, invoiceID)
	}
	if got.contentType != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", got.contentType)
	}
	var body map[string]any
	if err := json.Unmarshal(got.body, &body); err != nil {
		t.Fatalf("the body is not JSON: %v", err)
	}
	want := map[string]any{
		"reference":   invoiceID,
		"amount":      float64(1500000),
		"currency":    "BRL",
		"description": "Pedido 7b1c (MERCADO_LIVRE)",
		"callbackUrl": callbackURL,
	}
	if !reflect.DeepEqual(body, want) {
		t.Errorf("body = %v, want %v: the amount in cents", body, want)
	}
}

// PAY-05 and PAY-09: a refusal is the answer of the PSP, so it is returned and never retried.
func TestCreateChargeReturnsTheRefusalOf422WithoutRetrying(t *testing.T) {
	tests := []struct {
		name     string
		body     string
		wantCode string
	}{
		{"with a code", `{"code":"INSUFFICIENT_FUNDS"}`, "INSUFFICIENT_FUNDS"},
		{"without a code", `{}`, "UNSPECIFIED"},
		{"with a blank code", `{"code":"  "}`, "UNSPECIFIED"},
		{"that is not JSON", `refused`, "UNSPECIFIED"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fake := newFakePSP(t, always(http.StatusUnprocessableEntity, tt.body))

			_, err := newClient(fastConfig(fake.server.URL)).CreateCharge(context.Background(), chargeRequest(t))

			var refused *out.RefusedError
			if !errors.As(err, &refused) || refused.Code != tt.wantCode {
				t.Fatalf("error = %v, want a refusal with code %q", err, tt.wantCode)
			}
			if errors.Is(err, out.ErrUnavailable) {
				t.Error("a refusal is not an unavailable PSP")
			}
			if fake.hits.Load() != 1 {
				t.Errorf("the PSP received %d requests, want 1: a refusal is not retried", fake.hits.Load())
			}
		})
	}
}

// PAY-09: a timeout, a 5xx and a 429 are tried 3 times in total, and then the PSP is unavailable.
func TestCreateChargeTriesThreeTimesWhenThePSPFails(t *testing.T) {
	tests := []struct {
		name    string
		answer  func(w http.ResponseWriter, hit int)
		timeout time.Duration
	}{
		{"500", always(http.StatusInternalServerError, `{}`), 0},
		{"502", always(http.StatusBadGateway, `{}`), 0},
		{"503", always(http.StatusServiceUnavailable, `{}`), 0},
		{"429", always(http.StatusTooManyRequests, `{}`), 0},
		{"a timeout", func(w http.ResponseWriter, _ int) {
			time.Sleep(400 * time.Millisecond)
			reply(w, http.StatusCreated, createdBody)
		}, 100 * time.Millisecond},
		{"a body that stalls after the headers", func(w http.ResponseWriter, _ int) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			w.(http.Flusher).Flush()
			time.Sleep(400 * time.Millisecond)
			_, _ = io.WriteString(w, createdBody)
		}, 100 * time.Millisecond},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fake := newFakePSP(t, tt.answer)
			config := fastConfig(fake.server.URL)
			if tt.timeout > 0 {
				config.Timeout = tt.timeout
			}

			_, err := newClient(config).CreateCharge(context.Background(), chargeRequest(t))

			if !errors.Is(err, out.ErrUnavailable) {
				t.Fatalf("error = %v, want one that wraps ErrUnavailable", err)
			}
			if fake.hits.Load() != 3 {
				t.Errorf("the PSP received %d requests, want 3", fake.hits.Load())
			}
		})
	}
}

// PAY-09: after each failed attempt the call waits the backoff of that attempt: the first, then the second.
func TestCreateChargeWaitsTheBackoffOfEachAttemptBeforeTheNext(t *testing.T) {
	var mu sync.Mutex
	var arrivals []time.Time
	fake := newFakePSP(t, func(w http.ResponseWriter, _ int) {
		mu.Lock()
		arrivals = append(arrivals, time.Now())
		mu.Unlock()
		reply(w, http.StatusInternalServerError, `{}`)
	})
	config := fastConfig(fake.server.URL)
	config.Backoffs = []time.Duration{20 * time.Millisecond, time.Second}

	_, _ = newClient(config).CreateCharge(context.Background(), chargeRequest(t))

	mu.Lock()
	defer mu.Unlock()
	if len(arrivals) != 3 {
		t.Fatalf("the PSP received %d requests, want 3", len(arrivals))
	}
	first, second := arrivals[1].Sub(arrivals[0]), arrivals[2].Sub(arrivals[1])
	if first < 20*time.Millisecond || first > 700*time.Millisecond {
		t.Errorf("the wait after the first attempt was %v, want the first backoff (20ms), not the last one", first)
	}
	if second < time.Second {
		t.Errorf("the wait after the second attempt was %v, want at least the second backoff (1s)", second)
	}
}

func TestCreateChargeReportsAPSPThatRefusesConnections(t *testing.T) {
	fake := newFakePSP(t, always(http.StatusCreated, createdBody))
	config := fastConfig(fake.server.URL)
	fake.server.Close()

	_, err := newClient(config).CreateCharge(context.Background(), chargeRequest(t))

	if !errors.Is(err, out.ErrUnavailable) {
		t.Fatalf("error = %v, want one that wraps ErrUnavailable", err)
	}
}

// PAY-09 and PAY-02: a later attempt that works ends the call, with the same idempotency key.
func TestCreateChargeStopsRetryingWhenAnAttemptWorks(t *testing.T) {
	fake := newFakePSP(t, func(w http.ResponseWriter, hit int) {
		if hit == 1 {
			reply(w, http.StatusServiceUnavailable, `{}`)
			return
		}
		reply(w, http.StatusCreated, createdBody)
	})

	created, err := newClient(fastConfig(fake.server.URL)).CreateCharge(context.Background(), chargeRequest(t))

	if err != nil || created.ID != "ch_paid_"+invoiceID {
		t.Fatalf("CreateCharge() = (%q, %v), want the charge of the second attempt", created.ID, err)
	}
	if fake.hits.Load() != 2 {
		t.Fatalf("the PSP received %d requests, want 2", fake.hits.Load())
	}
	if first, second := fake.request(0), fake.request(1); first.idempotencyKey != invoiceID || second.idempotencyKey != invoiceID || !bytes.Equal(first.body, second.body) {
		t.Errorf("the attempts differ: keys %q and %q, bodies %s and %s; a retry must repeat the same charge", first.idempotencyKey, second.idempotencyKey, first.body, second.body)
	}
}

func TestCreateChargeRetriesWithoutWaitingWhenNoBackoffIsConfigured(t *testing.T) {
	for name, backoffs := range map[string][]time.Duration{
		"no waits":             nil,
		"fewer waits than due": {time.Millisecond},
	} {
		t.Run(name, func(t *testing.T) {
			fake := newFakePSP(t, always(http.StatusInternalServerError, `{}`))
			config := fastConfig(fake.server.URL)
			config.Backoffs = backoffs

			_, err := newClient(config).CreateCharge(context.Background(), chargeRequest(t))

			if !errors.Is(err, out.ErrUnavailable) || fake.hits.Load() != 3 {
				t.Fatalf("error = %v after %d requests, want ErrUnavailable after 3", err, fake.hits.Load())
			}
		})
	}
}

// Anything the contract does not describe is neither a refusal nor an unavailable PSP, and trying again at once changes nothing.
func TestCreateChargeReportsUnexpectedAnswersWithoutRetrying(t *testing.T) {
	tests := []struct {
		name   string
		status int
		body   string
	}{
		{"400", http.StatusBadRequest, `{}`},
		{"401", http.StatusUnauthorized, `{}`},
		{"404", http.StatusNotFound, `{}`},
		{"a charge without id", http.StatusCreated, `{"status":"PENDING"}`},
		{"a charge that is not JSON", http.StatusCreated, `created`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fake := newFakePSP(t, always(tt.status, tt.body))

			_, err := newClient(fastConfig(fake.server.URL)).CreateCharge(context.Background(), chargeRequest(t))

			var refused *out.RefusedError
			if err == nil || errors.Is(err, out.ErrUnavailable) || errors.As(err, &refused) {
				t.Fatalf("error = %v, want an unexpected error: not nil, not unavailable, not a refusal", err)
			}
			if fake.hits.Load() != 1 {
				t.Errorf("the PSP received %d requests, want 1", fake.hits.Load())
			}
		})
	}
}

// PAY-11: 5 consecutive failed attempts open the circuit, and an open circuit makes no call.
func TestTheCircuitOpensAfterFiveConsecutiveFailedAttempts(t *testing.T) {
	fake := newFakePSP(t, always(http.StatusInternalServerError, `{}`))
	var logs bytes.Buffer
	client := psp.NewClient(fastConfig(fake.server.URL), slog.New(slog.NewJSONHandler(&logs, nil)))
	create := func() error {
		_, err := client.CreateCharge(context.Background(), chargeRequest(t))
		return err
	}

	err := create()
	if !errors.Is(err, out.ErrUnavailable) || strings.Contains(err.Error(), "circuit") || fake.hits.Load() != 3 {
		t.Fatalf("first call: error = %v after %d requests, want 3 failed attempts and a closed circuit", err, fake.hits.Load())
	}

	err = create()
	if !errors.Is(err, out.ErrUnavailable) || !strings.Contains(err.Error(), "circuit is open") {
		t.Fatalf("second call: error = %v, want the circuit to open on its 5th failed attempt", err)
	}
	if fake.hits.Load() != 5 {
		t.Fatalf("the PSP received %d requests after the second call, want 5: the 6th attempt finds the circuit open", fake.hits.Load())
	}

	err = create()
	if !errors.Is(err, out.ErrUnavailable) || !strings.Contains(err.Error(), "circuit is open") || fake.hits.Load() != 5 {
		t.Fatalf("third call: error = %v after %d requests, want a call without request while the circuit is open", err, fake.hits.Load())
	}
	if !strings.Contains(logs.String(), "payment provider circuit changed") || !strings.Contains(logs.String(), `"to":"open"`) {
		t.Errorf("the log %q does not show the circuit opening", logs.String())
	}
}

// PAY-11: after its open period the circuit lets one call through; it closes when the PSP is back and opens again when it is not.
func TestTheCircuitTestsThePSPAfterItsOpenPeriod(t *testing.T) {
	var healthy atomic.Bool
	fake := newFakePSP(t, func(w http.ResponseWriter, _ int) {
		if healthy.Load() {
			reply(w, http.StatusCreated, createdBody)
			return
		}
		reply(w, http.StatusInternalServerError, `{}`)
	})
	config := fastConfig(fake.server.URL)
	config.Attempts = 1
	config.BreakerFailures = 2
	config.BreakerOpenFor = 500 * time.Millisecond
	client := newClient(config)
	create := func() error {
		_, err := client.CreateCharge(context.Background(), chargeRequest(t))
		return err
	}
	pastOpenPeriod := func() { time.Sleep(config.BreakerOpenFor + 150*time.Millisecond) }

	_ = create()
	_ = create()
	if err := create(); !errors.Is(err, out.ErrUnavailable) || fake.hits.Load() != 2 {
		t.Fatalf("while open: error = %v after %d requests, want ErrUnavailable and no new request", err, fake.hits.Load())
	}

	pastOpenPeriod()
	if err := create(); !errors.Is(err, out.ErrUnavailable) || fake.hits.Load() != 3 {
		t.Fatalf("after the open period: error = %v after %d requests, want one test call that fails", err, fake.hits.Load())
	}
	if err := create(); !errors.Is(err, out.ErrUnavailable) || fake.hits.Load() != 3 {
		t.Fatalf("after a failed test call: error = %v after %d requests, want the circuit open again", err, fake.hits.Load())
	}

	healthy.Store(true)
	pastOpenPeriod()
	for i := 0; i < 2; i++ {
		if err := create(); err != nil {
			t.Fatalf("call %d after the PSP recovered: error = %v, want success and a closed circuit", i+1, err)
		}
	}
	if fake.hits.Load() != 5 {
		t.Errorf("the PSP received %d requests, want 5", fake.hits.Load())
	}
}

// PAY-11: the circuit counts failures in a row, so a success between them starts the count over.
func TestASuccessStartsTheCountOfConsecutiveFailuresOver(t *testing.T) {
	fake := newFakePSP(t, func(w http.ResponseWriter, hit int) {
		if hit == 3 || hit >= 6 {
			reply(w, http.StatusCreated, createdBody)
			return
		}
		reply(w, http.StatusInternalServerError, `{}`)
	})
	config := fastConfig(fake.server.URL)
	config.Attempts = 1
	config.BreakerFailures = 3
	client := newClient(config)

	// Five of the first six calls fail, but never three in a row.
	for i, wantFailure := range []bool{true, true, false, true, true, false} {
		if _, err := client.CreateCharge(context.Background(), chargeRequest(t)); (err != nil) != wantFailure {
			t.Fatalf("call %d: error = %v, want a failure: %v", i+1, err, wantFailure)
		}
	}

	if _, err := client.CreateCharge(context.Background(), chargeRequest(t)); err != nil {
		t.Fatalf("call 7: error = %v, want the circuit to be closed", err)
	}
	if fake.hits.Load() != 7 {
		t.Errorf("the PSP received %d requests, want 7: none of the calls was kept from it", fake.hits.Load())
	}
}

// Operating the service: a postponed invoice has to say why, so every failed attempt is logged with what it was about.
func TestEveryFailedAttemptIsLoggedWithWhatTheCallWasAbout(t *testing.T) {
	tests := []struct {
		name      string
		call      func(client *psp.Client) error
		attribute string
		value     string
	}{
		{"creating a charge", func(client *psp.Client) error {
			_, err := client.CreateCharge(context.Background(), chargeRequest(t))
			return err
		}, "invoiceId", invoiceID},
		{"reading a charge", func(client *psp.Client) error {
			_, err := client.GetCharge(context.Background(), "ch_x")
			return err
		}, "chargeId", "ch_x"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fake := newFakePSP(t, always(http.StatusServiceUnavailable, `{}`))
			var logs bytes.Buffer
			client := psp.NewClient(fastConfig(fake.server.URL), slog.New(slog.NewJSONHandler(&logs, nil)))

			_ = tt.call(client)

			lines := strings.Split(strings.TrimSpace(logs.String()), "\n")
			if len(lines) != 3 {
				t.Fatalf("logged %d lines, want one per failed attempt (3): %s", len(lines), logs.String())
			}
			for i, line := range lines {
				var entry map[string]any
				if err := json.Unmarshal([]byte(line), &entry); err != nil {
					t.Fatalf("log line %q is not JSON: %v", line, err)
				}
				if message, _ := entry["error"].(string); entry["level"] != "WARN" || entry["attempt"] != float64(i+1) || entry["attempts"] != float64(3) ||
					entry[tt.attribute] != tt.value || !strings.Contains(message, "503") {
					t.Errorf("log line %d = %v, want a warning for attempt %d of 3 about %s %s with the cause", i+1, entry, i+1, tt.attribute, tt.value)
				}
			}
		})
	}
}

// The PSP answering, even to refuse, is not the PSP failing.
func TestAnswersOfThePSPNeverOpenTheCircuit(t *testing.T) {
	tests := []struct {
		name   string
		status int
		body   string
	}{
		{"refusals", http.StatusUnprocessableEntity, `{"code":"INSUFFICIENT_FUNDS"}`},
		{"unexpected answers", http.StatusBadRequest, `{}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fake := newFakePSP(t, always(tt.status, tt.body))
			config := fastConfig(fake.server.URL)
			config.Attempts = 1
			client := newClient(config)

			for i := 0; i < 12; i++ {
				_, err := client.CreateCharge(context.Background(), chargeRequest(t))
				if errors.Is(err, out.ErrUnavailable) {
					t.Fatalf("call %d: error = %v, want the PSP to be reached: the circuit must stay closed", i+1, err)
				}
			}
			if fake.hits.Load() != 12 {
				t.Errorf("the PSP received %d requests, want 12", fake.hits.Load())
			}
		})
	}
}

// A PSP that answers with more than the contract could ever need is not read to the end.
func TestAnAnswerOverOneMegabyteIsNotRead(t *testing.T) {
	huge := `{"id":"ch_x","padding":"` + strings.Repeat("a", 2<<20) + `"}`
	fake := newFakePSP(t, always(http.StatusCreated, huge))

	_, err := newClient(fastConfig(fake.server.URL)).CreateCharge(context.Background(), chargeRequest(t))

	if err == nil || errors.Is(err, out.ErrUnavailable) {
		t.Fatalf("error = %v, want an unexpected error and no charge", err)
	}
}

func TestGetChargeReadsTheStatusOfTheCharge(t *testing.T) {
	tests := []struct {
		name string
		body string
		want out.ChargeStatus
	}{
		{"paid", `{"id":"ch_paid_x","status":"PAID","failureReason":null}`, out.ChargeStatus{State: out.ChargePaid}},
		{"failed", `{"id":"ch_failed_x","status":"FAILED","failureReason":"INSUFFICIENT_FUNDS"}`, out.ChargeStatus{State: out.ChargeFailed, FailureReason: "INSUFFICIENT_FUNDS"}},
		{"pending", `{"id":"ch_x","status":"PENDING","failureReason":null}`, out.ChargeStatus{State: out.ChargePending}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fake := newFakePSP(t, always(http.StatusOK, tt.body))

			got, err := newClient(fastConfig(fake.server.URL)).GetCharge(context.Background(), "ch_x")

			if err != nil || got != tt.want {
				t.Fatalf("GetCharge() = (%+v, %v), want %+v", got, err, tt.want)
			}
			if request := fake.request(0); request.method != http.MethodGet || request.requestURI != "/psp/v1/charges/ch_x" {
				t.Errorf("request = %s %s, want GET /psp/v1/charges/ch_x", request.method, request.requestURI)
			}
		})
	}
}

func TestGetChargeEscapesTheChargeID(t *testing.T) {
	fake := newFakePSP(t, always(http.StatusOK, `{"status":"PAID"}`))

	_, err := newClient(fastConfig(fake.server.URL)).GetCharge(context.Background(), "a/b?c")

	if err != nil {
		t.Fatal(err)
	}
	if got := fake.request(0).requestURI; got != "/psp/v1/charges/a%2Fb%3Fc" {
		t.Errorf("request uri = %q, want the id escaped inside one path segment", got)
	}
}

func TestGetChargeReportsAnUnknownChargeWithoutRetrying(t *testing.T) {
	fake := newFakePSP(t, always(http.StatusNotFound, `{"code":"CHARGE_NOT_FOUND"}`))

	_, err := newClient(fastConfig(fake.server.URL)).GetCharge(context.Background(), "ch_unknown")

	if !errors.Is(err, out.ErrChargeNotFound) || errors.Is(err, out.ErrUnavailable) {
		t.Fatalf("error = %v, want ErrChargeNotFound and not ErrUnavailable", err)
	}
	if fake.hits.Load() != 1 {
		t.Errorf("the PSP received %d requests, want 1", fake.hits.Load())
	}
}

func TestGetChargeReportsAnswersItCannotUse(t *testing.T) {
	tests := []struct {
		name   string
		status int
		body   string
	}{
		{"a status the contract does not have", http.StatusOK, `{"status":"REFUNDED"}`},
		{"a missing status", http.StatusOK, `{}`},
		{"a body that is not JSON", http.StatusOK, `paid`},
		{"an unexpected status code", http.StatusForbidden, `{}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fake := newFakePSP(t, always(tt.status, tt.body))

			got, err := newClient(fastConfig(fake.server.URL)).GetCharge(context.Background(), "ch_x")

			if err == nil || errors.Is(err, out.ErrUnavailable) || errors.Is(err, out.ErrChargeNotFound) {
				t.Fatalf("GetCharge() = (%+v, %v), want an unexpected error", got, err)
			}
			if fake.hits.Load() != 1 {
				t.Errorf("the PSP received %d requests, want 1", fake.hits.Load())
			}
		})
	}
}

func TestGetChargeTriesAgainWhenThePSPFails(t *testing.T) {
	fake := newFakePSP(t, func(w http.ResponseWriter, hit int) {
		if hit < 3 {
			reply(w, http.StatusServiceUnavailable, `{}`)
			return
		}
		reply(w, http.StatusOK, `{"status":"PAID"}`)
	})

	got, err := newClient(fastConfig(fake.server.URL)).GetCharge(context.Background(), "ch_x")

	if err != nil || got.State != out.ChargePaid || fake.hits.Load() != 3 {
		t.Fatalf("GetCharge() = (%+v, %v) after %d requests, want PAID on the 3rd", got, err, fake.hits.Load())
	}
}

func TestAContextThatEndsStopsTheCallInsteadOfWaitingForTheNextAttempt(t *testing.T) {
	fake := newFakePSP(t, always(http.StatusInternalServerError, `{}`))
	config := fastConfig(fake.server.URL)
	config.Backoffs = []time.Duration{10 * time.Second}
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	started := time.Now()

	_, err := newClient(config).CreateCharge(ctx, chargeRequest(t))

	if !errors.Is(err, context.DeadlineExceeded) || errors.Is(err, out.ErrUnavailable) {
		t.Fatalf("error = %v, want the context error and not ErrUnavailable", err)
	}
	if elapsed := time.Since(started); elapsed > 5*time.Second {
		t.Errorf("the call took %v, want it to end with its context", elapsed)
	}
	if fake.hits.Load() > 1 {
		t.Errorf("the PSP received %d requests, want no attempt after the context ended", fake.hits.Load())
	}
}

// A shutdown cancels the context of the call: that says nothing about the PSP.
func TestACanceledCallDoesNotCountAgainstTheCircuit(t *testing.T) {
	fake := newFakePSP(t, always(http.StatusCreated, createdBody))
	config := fastConfig(fake.server.URL)
	config.Attempts = 1 // no wait to end in: the error of the call itself has to say that it was canceled
	config.BreakerFailures = 2
	client := newClient(config)
	canceled, cancel := context.WithCancel(context.Background())
	cancel()

	for i := 0; i < 3; i++ {
		_, err := client.CreateCharge(canceled, chargeRequest(t))
		if !errors.Is(err, context.Canceled) || errors.Is(err, out.ErrUnavailable) {
			t.Fatalf("call %d: error = %v, want context.Canceled and not ErrUnavailable", i+1, err)
		}
	}

	if _, err := client.CreateCharge(context.Background(), chargeRequest(t)); err != nil {
		t.Fatalf("the call after the canceled ones: error = %v, want the circuit to be closed", err)
	}
}

func TestRequestsCarryTheTraceOfTheCaller(t *testing.T) {
	provider := sdktrace.NewTracerProvider()
	otel.SetTracerProvider(provider)
	otel.SetTextMapPropagator(propagation.TraceContext{})
	t.Cleanup(func() { _ = provider.Shutdown(context.Background()) })
	fake := newFakePSP(t, always(http.StatusCreated, createdBody))
	ctx, span := provider.Tracer("test").Start(context.Background(), "caller")
	defer span.End()

	if _, err := newClient(fastConfig(fake.server.URL)).CreateCharge(ctx, chargeRequest(t)); err != nil {
		t.Fatal(err)
	}

	if got := fake.request(0).traceparent; !strings.Contains(got, span.SpanContext().TraceID().String()) {
		t.Errorf("traceparent = %q, want it to continue the trace %s", got, span.SpanContext().TraceID())
	}
}
