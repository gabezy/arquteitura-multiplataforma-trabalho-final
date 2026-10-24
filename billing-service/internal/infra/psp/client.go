// Package psp is the adapter of the payment provider: an HTTP client with the
// resilience the spec asks for (timeout, retry with backoff, circuit breaker).
package psp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/sony/gobreaker/v2"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/port/out"
)

// maxBody bounds what is read from an answer of the PSP.
const maxBody = 1 << 20

// Config tunes the client. DefaultConfig has the values of the spec.
type Config struct {
	// BaseURL is the PSP, such as http://wiremock:8080.
	BaseURL string
	// CallbackURL is where the PSP reports the result of a charge.
	CallbackURL string
	// Timeout bounds each attempt, headers and body included.
	Timeout time.Duration
	// Attempts is how many times a call is tried in total.
	Attempts int
	// Backoffs are the waits between attempts: Backoffs[0] after the first one, and so on.
	Backoffs []time.Duration
	// BreakerFailures is how many consecutive failed attempts open the circuit.
	BreakerFailures uint32
	// BreakerOpenFor is how long the circuit stays open before it lets one attempt through.
	BreakerOpenFor time.Duration
}

// DefaultConfig is 3 s per attempt, 3 attempts with 200 ms and 400 ms between them, and a
// circuit that opens after 5 consecutive failed attempts and stays open for 30 s.
func DefaultConfig(baseURL, callbackURL string) Config {
	return Config{
		BaseURL:         baseURL,
		CallbackURL:     callbackURL,
		Timeout:         3 * time.Second,
		Attempts:        3,
		Backoffs:        []time.Duration{200 * time.Millisecond, 400 * time.Millisecond},
		BreakerFailures: 5,
		BreakerOpenFor:  30 * time.Second,
	}
}

// Client talks to the PSP. It implements out.PaymentGateway.
type Client struct {
	config  Config
	http    *http.Client
	breaker *gobreaker.CircuitBreaker[*answer]
}

// answer is what the PSP said, with its body already read: an attempt holds the connection, and the
// timeout, until it has the whole answer.
type answer struct {
	status int
	body   []byte
}

func (a *answer) decode(into any) error { return json.Unmarshal(a.body, into) }

var _ out.PaymentGateway = (*Client)(nil)

func NewClient(config Config, logger *slog.Logger) *Client {
	config.BaseURL = strings.TrimRight(config.BaseURL, "/")
	return &Client{
		config: config,
		http:   &http.Client{Timeout: config.Timeout, Transport: otelhttp.NewTransport(http.DefaultTransport)},
		breaker: gobreaker.NewCircuitBreaker[*answer](gobreaker.Settings{
			Name:        "psp",
			MaxRequests: 1,
			Timeout:     config.BreakerOpenFor,
			ReadyToTrip: func(counts gobreaker.Counts) bool { return counts.ConsecutiveFailures >= config.BreakerFailures },
			// A shutdown is not a failure of the PSP.
			IsSuccessful: func(err error) bool { return err == nil || errors.Is(err, context.Canceled) },
			OnStateChange: func(name string, from, to gobreaker.State) {
				logger.Warn("payment provider circuit changed", "circuit", name, "from", from.String(), "to", to.String())
			},
		}),
	}
}

type chargeRequestBody struct {
	Reference   string `json:"reference"`
	Amount      int64  `json:"amount"`
	Currency    string `json:"currency"`
	Description string `json:"description"`
	CallbackURL string `json:"callbackUrl"`
}

type chargeResponseBody struct {
	ID            string `json:"id"`
	Status        string `json:"status"`
	FailureReason string `json:"failureReason"`
}

type refusalBody struct {
	Code string `json:"code"`
}

// CreateCharge asks the PSP to charge the invoice. The invoice id is the idempotency key, so a
// retry never creates a second charge. A 422 is a refusal (*out.RefusedError). A PSP that cannot be
// reached is an error that wraps out.ErrUnavailable. Any other answer is an unexpected error.
func (c *Client) CreateCharge(ctx context.Context, request out.ChargeRequest) (out.ChargeCreated, error) {
	payload, err := json.Marshal(chargeRequestBody{
		Reference:   request.InvoiceID,
		Amount:      request.Amount.Cents(),
		Currency:    "BRL",
		Description: request.Description,
		CallbackURL: c.config.CallbackURL,
	})
	if err != nil {
		return out.ChargeCreated{}, fmt.Errorf("encode the charge request: %w", err)
	}

	reply, err := c.do(ctx, func(ctx context.Context) (*http.Request, error) {
		httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, c.config.BaseURL+"/psp/v1/charges", bytes.NewReader(payload))
		if err != nil {
			return nil, err
		}
		httpRequest.Header.Set("Content-Type", "application/json")
		httpRequest.Header.Set("Idempotency-Key", request.InvoiceID)
		return httpRequest, nil
	})
	if err != nil {
		return out.ChargeCreated{}, err
	}

	switch reply.status {
	case http.StatusCreated:
		var charge chargeResponseBody
		if err := reply.decode(&charge); err != nil || charge.ID == "" {
			return out.ChargeCreated{}, errors.New("the PSP accepted the charge without an id")
		}
		return out.ChargeCreated{ID: charge.ID}, nil
	case http.StatusUnprocessableEntity:
		var refusal refusalBody
		_ = reply.decode(&refusal)
		if strings.TrimSpace(refusal.Code) == "" {
			refusal.Code = "UNSPECIFIED"
		}
		return out.ChargeCreated{}, &out.RefusedError{Code: refusal.Code}
	default:
		return out.ChargeCreated{}, fmt.Errorf("unexpected status %d creating the charge", reply.status)
	}
}

// GetCharge asks the PSP where a charge is. A charge the PSP does not know is out.ErrChargeNotFound.
func (c *Client) GetCharge(ctx context.Context, chargeID string) (out.ChargeStatus, error) {
	reply, err := c.do(ctx, func(ctx context.Context) (*http.Request, error) {
		return http.NewRequestWithContext(ctx, http.MethodGet, c.config.BaseURL+"/psp/v1/charges/"+url.PathEscape(chargeID), nil)
	})
	if err != nil {
		return out.ChargeStatus{}, err
	}

	switch reply.status {
	case http.StatusOK:
		var charge chargeResponseBody
		if err := reply.decode(&charge); err != nil {
			return out.ChargeStatus{}, fmt.Errorf("the charge answer is not valid JSON: %w", err)
		}
		switch state := out.ChargeState(charge.Status); state {
		case out.ChargePending, out.ChargePaid, out.ChargeFailed:
			return out.ChargeStatus{State: state, FailureReason: charge.FailureReason}, nil
		default:
			return out.ChargeStatus{}, fmt.Errorf("unknown charge status %q", charge.Status)
		}
	case http.StatusNotFound:
		return out.ChargeStatus{}, fmt.Errorf("%w: %s", out.ErrChargeNotFound, chargeID)
	default:
		return out.ChargeStatus{}, fmt.Errorf("unexpected status %d reading the charge", reply.status)
	}
}

// do sends the request with the resilience of the spec and returns the first answer that is not a
// 5xx or a 429. A 4xx is the PSP answering, so it is never retried and never counts against the
// circuit. A PSP that cannot be reached, or whose answer does not arrive whole in time, fails with
// out.ErrUnavailable once the attempts are spent or the circuit is open, and a canceled context ends
// the call at once.
func (c *Client) do(ctx context.Context, build func(ctx context.Context) (*http.Request, error)) (*answer, error) {
	var last error
	for attempt := 1; attempt <= c.config.Attempts; attempt++ {
		reply, err := c.breaker.Execute(func() (*answer, error) { return c.attempt(ctx, build) })
		if err == nil {
			return reply, nil
		}
		if errors.Is(err, gobreaker.ErrOpenState) || errors.Is(err, gobreaker.ErrTooManyRequests) {
			return nil, fmt.Errorf("%w: the circuit is open", out.ErrUnavailable)
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}

		last = err
		if attempt < c.config.Attempts {
			if err := sleep(ctx, c.backoff(attempt)); err != nil {
				return nil, err
			}
		}
	}
	return nil, fmt.Errorf("%w: %w", out.ErrUnavailable, last)
}

// backoff is the wait after the given failed attempt: the last configured one when there are fewer
// entries than waits, and none when there are no entries.
func (c *Client) backoff(attempt int) time.Duration {
	if len(c.config.Backoffs) == 0 {
		return 0
	}
	return c.config.Backoffs[min(attempt, len(c.config.Backoffs))-1]
}

func (c *Client) attempt(ctx context.Context, build func(ctx context.Context) (*http.Request, error)) (*answer, error) {
	request, err := build(ctx)
	if err != nil {
		return nil, err
	}
	response, err := c.http.Do(request)
	if err != nil {
		return nil, err
	}
	defer func() { _ = response.Body.Close() }()

	body, err := io.ReadAll(io.LimitReader(response.Body, maxBody))
	if err != nil {
		return nil, err
	}
	if response.StatusCode >= http.StatusInternalServerError || response.StatusCode == http.StatusTooManyRequests {
		return nil, fmt.Errorf("the PSP answered %d", response.StatusCode)
	}
	return &answer{status: response.StatusCode, body: body}, nil
}

func sleep(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
