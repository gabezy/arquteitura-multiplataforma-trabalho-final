package app_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/app"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/testsupport"
)

// pendingInvoice sends the order of one iPhone to a service whose PSP never calls the webhook, and returns the
// invoice and its charge once the invoice waits as PAYMENT_PENDING.
func pendingInvoice(t *testing.T, service chargingService) (invoiceID, chargeID string) {
	t.Helper()
	if err := service.producer.ProduceSync(context.Background(),
		orderEvent(confirmedTopic, "evt-1", orderOne, iphonesBody(orderOne, "AMAZON", 1)),
	).FirstErr(); err != nil {
		t.Fatal(err)
	}
	eventuallyWithin(t, 20*time.Second, "the invoice to wait for its webhook", func() bool { return invoiceStatus(t, service.port, orderOne) == "PAYMENT_PENDING" })
	invoice, _ := invoicesOf(t, service.port, orderOne)[0].(map[string]any)
	return invoice["id"].(string), invoice["pspTransactionId"].(string)
}

// holdInvoiceRow locks the row of the invoice from outside the service, so that whatever the service does to the
// invoice waits. The returned function releases the lock; it also runs when the test ends.
func holdInvoiceRow(t *testing.T, databaseURL, invoiceID string) (release func()) {
	t.Helper()
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `SELECT id FROM invoices WHERE id = $1 FOR UPDATE`, invoiceID); err != nil {
		t.Fatal(err)
	}
	var once sync.Once
	release = func() {
		once.Do(func() {
			_ = tx.Commit(ctx)
			_ = conn.Close(ctx)
		})
	}
	t.Cleanup(release)
	return release
}

type webhookResult struct {
	status int
	err    error
}

// sendPaidWebhook reports the payment of the invoice to the service, in the background.
func sendPaidWebhook(port int, invoiceID, chargeID string) <-chan webhookResult {
	result := make(chan webhookResult, 1)
	go func() {
		body, _ := json.Marshal(map[string]any{"chargeId": chargeID, "reference": invoiceID, "status": "PAID"})
		status, err := postWebhook("http://127.0.0.1:"+strconv.Itoa(port)+"/webhooks/psp", testWebhookToken, body)
		result <- webhookResult{status, err}
	}()
	return result
}

type invoiceRow struct {
	id       string
	status   string
	attempts int
	next     *string
	charge   *string
}

// storedInvoice reads the only invoice of the database, which works while the service is down.
func storedInvoice(t *testing.T, databaseURL string) invoiceRow {
	t.Helper()
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close(ctx) }()
	var row invoiceRow
	if err := conn.QueryRow(ctx, `SELECT id::text, status, payment_attempts, next_payment_attempt_at::text, psp_transaction_id FROM invoices`).
		Scan(&row.id, &row.status, &row.attempts, &row.next, &row.charge); err != nil {
		t.Fatal(err)
	}
	return row
}

func countPaymentEvents(t *testing.T, databaseURL string) int {
	t.Helper()
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close(ctx) }()
	var count int
	if err := conn.QueryRow(ctx, `SELECT count(*) FROM outbox WHERE event_type LIKE 'billing.payment.%'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

// BOOT-06: the request being served when SIGTERM arrives is finished, and Run returns once it is.
func TestShutdownFinishesTheRequestBeingServed(t *testing.T) {
	psp := newFakePSP(t)
	psp.silent.Store(true)
	databaseURL := testsupport.NewDatabase(t)
	service := runCharging(t, psp.server.URL, databaseURL, newPaymentCluster(t))
	invoiceID, chargeID := pendingInvoice(t, service)
	release := holdInvoiceRow(t, databaseURL, invoiceID)
	webhook := sendPaidWebhook(service.port, invoiceID, chargeID)
	time.Sleep(700 * time.Millisecond)
	select {
	case r := <-webhook:
		t.Fatalf("the webhook finished (%+v) while the invoice was locked, want it to wait", r)
	default:
	}

	service.stop()
	time.Sleep(700 * time.Millisecond)
	select {
	case err := <-service.done:
		t.Fatalf("Run returned (%v) while a request was still being served", err)
	default:
	}
	release()

	select {
	case r := <-webhook:
		if r.err != nil || r.status != http.StatusNoContent {
			t.Fatalf("the request in flight ended with %+v, want it to finish with 204", r)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the request in flight never finished")
	}
	select {
	case err := <-service.done:
		if err != nil {
			t.Fatalf("Run = %v, want nil once the request finished", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("Run did not return after the request finished")
	}
	if row := storedInvoice(t, databaseURL); row.status != "PAID" {
		t.Fatalf("the invoice is %s after the request that finished, want PAID", row.status)
	}
}

// holdingPSP keeps the charge request open until its context ends, as long as hold is set, and answers like the
// fake PSP afterwards. It remembers the idempotency key of every request.
type holdingPSP struct {
	server  *httptest.Server
	hold    atomic.Bool
	arrived chan struct{}
	once    sync.Once
	mu      sync.Mutex
	keys    []string
}

func newHoldingPSP(t *testing.T) *holdingPSP {
	t.Helper()
	psp := &holdingPSP{arrived: make(chan struct{})}
	psp.hold.Store(true)
	mux := http.NewServeMux()
	mux.HandleFunc("POST /psp/v1/charges", func(w http.ResponseWriter, r *http.Request) {
		var charge struct {
			Reference   string `json:"reference"`
			CallbackURL string `json:"callbackUrl"`
		}
		_ = json.NewDecoder(r.Body).Decode(&charge)
		psp.mu.Lock()
		psp.keys = append(psp.keys, r.Header.Get("Idempotency-Key"))
		psp.mu.Unlock()
		if psp.hold.Load() {
			psp.once.Do(func() { close(psp.arrived) })
			select {
			case <-r.Context().Done():
			case <-time.After(30 * time.Second):
			}
			return
		}
		id := "ch_paid_" + charge.Reference
		replyJSON(w, http.StatusCreated, map[string]any{"id": id, "reference": charge.Reference, "status": "PENDING"})
		go func() {
			time.Sleep(reportDelay)
			body, _ := json.Marshal(map[string]any{"chargeId": id, "reference": charge.Reference, "status": "PAID", "failureReason": nil, "occurredAt": time.Now().UTC().Format(time.RFC3339)})
			_, _ = postWebhook(charge.CallbackURL, testWebhookToken, body)
		}()
	})
	psp.server = httptest.NewServer(mux)
	t.Cleanup(psp.server.Close)
	return psp
}

func (p *holdingPSP) idempotencyKeys() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]string(nil), p.keys...)
}

// BOOT-06 and PAY-01: a charge in flight when SIGTERM arrives is rolled back, leaving the invoice as it was, and
// the next instance charges it again with the same idempotency key, so the PSP cannot charge twice.
func TestShutdownRollsBackTheChargeInFlightAndItIsTriedAgainWithTheSameKey(t *testing.T) {
	psp := newHoldingPSP(t)
	databaseURL := testsupport.NewDatabase(t)
	brokers := newPaymentCluster(t)
	first := runCharging(t, psp.server.URL, databaseURL, brokers)
	if err := first.producer.ProduceSync(context.Background(),
		orderEvent(confirmedTopic, "evt-1", orderOne, iphonesBody(orderOne, "AMAZON", 1)),
	).FirstErr(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-psp.arrived:
	case <-time.After(30 * time.Second):
		t.Fatal("the charge request never reached the PSP")
	}

	first.stop()
	select {
	case <-first.done:
	case <-time.After(app.ShutdownTimeout + 2*time.Second):
		t.Fatal("Run did not return after the cancellation")
	}

	row := storedInvoice(t, databaseURL)
	if row.status != "ISSUED" || row.attempts != 0 || row.next != nil || row.charge != nil {
		t.Fatalf("invoice after the shutdown = %+v, want it as it was: ISSUED, no attempt, no next attempt, no charge", row)
	}
	if events := countPaymentEvents(t, databaseURL); events != 0 {
		t.Fatalf("%d payment events after the charge that was rolled back, want none", events)
	}

	psp.hold.Store(false)
	second := runCharging(t, psp.server.URL, databaseURL, brokers)
	eventuallyWithin(t, 30*time.Second, "the next instance to charge the invoice", func() bool { return invoiceStatus(t, second.port, orderOne) == "PAID" })
	keys := psp.idempotencyKeys()
	if len(keys) < 2 || keys[0] != row.id || keys[len(keys)-1] != row.id {
		t.Fatalf("idempotency keys = %v, want the invoice id %s on the request that was interrupted and on the one that went through", keys, row.id)
	}
}

// BOOT-06: the process exits within its budget even when a request never finishes, because the request is
// cancelled when the time to finish it is over, and gives its database connection back.
func TestShutdownEndsWithinItsBudgetEvenWithARequestThatNeverFinishes(t *testing.T) {
	psp := newFakePSP(t)
	psp.silent.Store(true)
	databaseURL := testsupport.NewDatabase(t)
	service := runCharging(t, psp.server.URL, databaseURL, newPaymentCluster(t))
	invoiceID, chargeID := pendingInvoice(t, service)
	holdInvoiceRow(t, databaseURL, invoiceID) // never released while the test runs
	sendPaidWebhook(service.port, invoiceID, chargeID)
	time.Sleep(700 * time.Millisecond)

	started := time.Now()
	service.stop()
	select {
	case err := <-service.done:
		elapsed := time.Since(started)
		// 7 s to finish what is running, then the pool; main keeps 2 s of the 10 for the telemetry.
		if limit := app.ShutdownTimeout + 2*time.Second; elapsed > limit {
			t.Fatalf("Run took %v to return, want it within %v", elapsed, limit)
		}
		if err == nil {
			t.Error("Run = nil, want the error of the shutdown that ran out of time")
		}
	case <-time.After(app.ShutdownTimeout + 5*time.Second):
		t.Fatal("Run did not return: a request that waits on the database keeps the process from exiting")
	}
}
