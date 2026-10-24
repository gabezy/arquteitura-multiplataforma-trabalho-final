package app_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/twmb/franz-go/pkg/kfake"
	"github.com/twmb/franz-go/pkg/kgo"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/testsupport"
)

const (
	testWebhookToken    = "test-webhook-token"
	paymentConfirmed    = "billing.payment.confirmed.v1"
	paymentFailed       = "billing.payment.failed.v1"
	insufficientFunds   = int64(10_000_000) // R$ 100.000,00 in cents, where the simulated PSP starts to refuse
	minimumCharge       = int64(100)        // R$ 1,00 in cents, below which this PSP refuses to create the charge
	reportDelay         = 100 * time.Millisecond
	paymentPollInterval = "50ms"
)

// fakePSP answers like the WireMock mappings of docker/wiremock: it accepts every charge with 201 PENDING and,
// a moment later, reports PAID by webhook, or FAILED for a charge of R$ 100.000,00 or more. A test can also make it
// refuse, go down, forget the webhook, or stay undecided when asked about a charge.
type fakePSP struct {
	server   *httptest.Server
	requests atomic.Int32 // charges asked for
	queries  atomic.Int32 // charges asked about
	down     atomic.Bool  // answers every charge with 503
	silent   atomic.Bool  // accepts the charge but never calls the webhook
	pending  atomic.Bool  // answers every query with PENDING
}

func replyJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func newFakePSP(t *testing.T) *fakePSP {
	t.Helper()
	psp := &fakePSP{}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /psp/v1/charges", func(w http.ResponseWriter, r *http.Request) {
		psp.requests.Add(1)
		if psp.down.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		var charge struct {
			Reference   string `json:"reference"`
			Amount      int64  `json:"amount"`
			CallbackURL string `json:"callbackUrl"`
		}
		_ = json.NewDecoder(r.Body).Decode(&charge)
		if charge.Amount < minimumCharge {
			replyJSON(w, http.StatusUnprocessableEntity, map[string]any{"code": "AMOUNT_NOT_ALLOWED"})
			return
		}
		id, status, reason := "ch_paid_"+charge.Reference, "PAID", any(nil)
		if charge.Amount >= insufficientFunds {
			id, status, reason = "ch_failed_"+charge.Reference, "FAILED", "INSUFFICIENT_FUNDS"
		}

		replyJSON(w, http.StatusCreated, map[string]any{"id": id, "reference": charge.Reference, "status": "PENDING"})
		if psp.silent.Load() {
			return
		}
		go func() {
			time.Sleep(reportDelay)
			body, _ := json.Marshal(map[string]any{
				"chargeId": id, "reference": charge.Reference, "status": status, "failureReason": reason,
				"occurredAt": time.Now().UTC().Format(time.RFC3339),
			})
			_, _ = postWebhook(charge.CallbackURL, testWebhookToken, body)
		}()
	})
	mux.HandleFunc("GET /psp/v1/charges/{id}", func(w http.ResponseWriter, r *http.Request) {
		psp.queries.Add(1)
		id := r.PathValue("id")
		status, reason := "PAID", any(nil)
		switch {
		case psp.pending.Load():
			status = "PENDING"
		case strings.HasPrefix(id, "ch_failed_"):
			status, reason = "FAILED", "INSUFFICIENT_FUNDS"
		}
		replyJSON(w, http.StatusOK, map[string]any{"id": id, "status": status, "failureReason": reason})
	})
	psp.server = httptest.NewServer(mux)
	t.Cleanup(psp.server.Close)
	return psp
}

// postWebhook calls the webhook of the service as the PSP does and returns the status it answered.
func postWebhook(target, token string, body []byte) (int, error) {
	request, err := http.NewRequestWithContext(context.Background(), http.MethodPost, target, bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	request.Header.Set("Content-Type", "application/json")
	if token != "" {
		request.Header.Set("X-PSP-Token", token)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return 0, err
	}
	defer func() { _ = response.Body.Close() }()
	return response.StatusCode, nil
}

// iphonesBody is an order of n iPhones at R$ 15.000,00 each.
func iphonesBody(orderID, marketplace string, n int) string {
	return orderBody(orderID, marketplace, n, "15000.00", strconv.Itoa(n*15000)+".00")
}

// orderBody is an order of one item, with its unit price and the total the order declares.
func orderBody(orderID, marketplace string, quantity int, unitPrice, total string) string {
	return `{"orderId":"` + orderID + `","marketplace":"` + marketplace + `","externalOrderId":"EXT-` + orderID[len(orderID)-1:] + `",` +
		`"items":[{"sku":"231","quantity":` + strconv.Itoa(quantity) + `,"unitPrice":` + unitPrice + `}],"total":` + total + `}`
}

// chargingService is the service running against a PSP, with what a test needs to stop it and to look at it.
type chargingService struct {
	port        int
	brokers     []string
	databaseURL string
	producer    *kgo.Client
	stop        context.CancelFunc // what a SIGTERM does to Run
	done        <-chan error       // the result of Run
}

// newPaymentCluster is an in-memory Kafka with every topic the billing-service reads or writes.
func newPaymentCluster(t *testing.T) []string {
	t.Helper()
	cluster, err := kfake.NewCluster(kfake.NumBrokers(1), kfake.SeedTopics(1,
		confirmedTopic, cancelledTopic, issuedTopic, deadLetter, paymentConfirmed, paymentFailed))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(cluster.Close)
	return cluster.ListenAddrs()
}

// runCharging runs the service against the PSP at pspURL, a payment round every 50 ms, and the webhook pointed at
// itself, on the database and the Kafka it is given. The settings of the extra maps are added on top, for a test that
// needs another interval. Two instances can share a database to see what the second finds after the first stopped.
func runCharging(t *testing.T, pspURL, databaseURL string, brokers []string, extra ...map[string]string) chargingService {
	t.Helper()
	port := freePort(t)
	settings := map[string]string{
		"PORT":                  strconv.Itoa(port),
		"PSP_BASE_URL":          pspURL,
		"PSP_CALLBACK_URL":      "http://127.0.0.1:" + strconv.Itoa(port) + "/webhooks/psp",
		"PAYMENT_POLL_INTERVAL": paymentPollInterval,
	}
	for _, more := range extra {
		for key, value := range more {
			settings[key] = value
		}
	}
	cfg := testConfigWith(t, databaseURL, brokers, settings)
	stop, done := start(t, cfg)
	waitUntilHealthy(t, cfg.Port, done)

	producer, err := kgo.NewClient(kgo.SeedBrokers(brokers...))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(producer.Close)
	return chargingService{port: cfg.Port, brokers: brokers, databaseURL: databaseURL, producer: producer, stop: stop, done: done}
}

// startCharging runs the service with the fake PSP on a new database and a new Kafka.
func startCharging(t *testing.T, psp *fakePSP, extra ...map[string]string) (cfgPort int, brokers []string, producer *kgo.Client) {
	t.Helper()
	service := runCharging(t, psp.server.URL, testsupport.NewDatabase(t), newPaymentCluster(t), extra...)
	return service.port, service.brokers, service.producer
}

func invoiceStatus(t *testing.T, port int, orderID string) string {
	t.Helper()
	invoices := invoicesOf(t, port, orderID)
	if len(invoices) != 1 {
		return ""
	}
	status, _ := invoices[0].(map[string]any)["status"].(string)
	return status
}

// consumeFor reads a topic for a while and returns what it holds, to show that nothing more arrived.
func consumeFor(t *testing.T, brokers []string, topic string, wait time.Duration) []*kgo.Record {
	t.Helper()
	client, err := kgo.NewClient(kgo.SeedBrokers(brokers...), kgo.ConsumeTopics(topic), kgo.ConsumeResetOffset(kgo.NewOffset().AtStart()))
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	ctx, cancel := context.WithTimeout(context.Background(), wait)
	defer cancel()
	var records []*kgo.Record
	for ctx.Err() == nil {
		client.PollFetches(ctx).EachRecord(func(r *kgo.Record) { records = append(records, r) })
	}
	return records
}

func valueOf(t *testing.T, record *kgo.Record) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(record.Value, &body); err != nil {
		t.Fatalf("the event %q is not JSON: %v", record.Value, err)
	}
	return body
}

// PAY-01 to PAY-07 through the whole service: one iPhone ends PAID and seven end PAYMENT_FAILED, each with its event.
func TestInvoicesAreChargedAndTheOutcomeIsPublished(t *testing.T) {
	psp := newFakePSP(t)
	port, brokers, producer := startCharging(t, psp)
	if err := producer.ProduceSync(context.Background(),
		orderEvent(confirmedTopic, "evt-1", orderOne, iphonesBody(orderOne, "AMAZON", 1)),
		orderEvent(confirmedTopic, "evt-2", orderTwo, iphonesBody(orderTwo, "SHOPEE", 7)),
	).FirstErr(); err != nil {
		t.Fatal(err)
	}

	// The poll of the test is 50 ms and the webhook comes 100 ms later, so 15 s only passes if the payment worker
	// really runs on PAYMENT_POLL_INTERVAL and not on the 30 s of the reconciliation.
	eventuallyWithin(t, 15*time.Second, "the first order to be paid", func() bool { return invoiceStatus(t, port, orderOne) == "PAID" })
	eventuallyWithin(t, 15*time.Second, "the second order to be refused", func() bool { return invoiceStatus(t, port, orderTwo) == "PAYMENT_FAILED" })

	paid, _ := invoicesOf(t, port, orderOne)[0].(map[string]any)
	if paid["pspTransactionId"] != "ch_paid_"+paid["id"].(string) || paid["paidAt"] == nil || paid["failureReason"] != nil || paid["failedAt"] != nil {
		t.Fatalf("paid invoice = %v, want its charge and the time it was paid", paid)
	}
	refused, _ := invoicesOf(t, port, orderTwo)[0].(map[string]any)
	if refused["pspTransactionId"] != "ch_failed_"+refused["id"].(string) || refused["failureReason"] != "INSUFFICIENT_FUNDS" || refused["failedAt"] == nil || refused["paidAt"] != nil {
		t.Fatalf("refused invoice = %v, want its charge, INSUFFICIENT_FUNDS and the time it failed", refused)
	}

	confirmed := consume(t, brokers, paymentConfirmed, 1)
	if len(confirmed) != 1 || string(confirmed[0].Key) != paid["id"] || headerOf(confirmed[0], "ce_type") != paymentConfirmed {
		t.Fatalf("billing.payment.confirmed.v1 events = %v, want one keyed by the paid invoice", confirmed)
	}
	if body := valueOf(t, confirmed[0]); body["invoiceId"] != paid["id"] || body["orderId"] != orderOne || body["amount"] != 15000.0 ||
		body["pspTransactionId"] != paid["pspTransactionId"] || body["paidAt"] == nil {
		t.Fatalf("billing.payment.confirmed.v1 = %v, want the invoice, the order, 15000.00, the charge and the time", body)
	}
	failed := consume(t, brokers, paymentFailed, 1)
	if len(failed) != 1 || string(failed[0].Key) != refused["id"] || headerOf(failed[0], "ce_type") != paymentFailed {
		t.Fatalf("billing.payment.failed.v1 events = %v, want one keyed by the refused invoice", failed)
	}
	if body := valueOf(t, failed[0]); body["orderId"] != orderTwo || body["amount"] != 105000.0 || body["reason"] != "INSUFFICIENT_FUNDS" || body["failedAt"] == nil {
		t.Fatalf("billing.payment.failed.v1 = %v, want the order, 105000.00, the reason and the time", body)
	}

	// PAY-07: the PSP reports the same payment again, and nothing changes or is published.
	webhook := "http://127.0.0.1:" + strconv.Itoa(port) + "/webhooks/psp"
	repeat, _ := json.Marshal(map[string]any{"chargeId": paid["pspTransactionId"], "reference": paid["id"], "status": "PAID"})
	if status, err := postWebhook(webhook, testWebhookToken, repeat); err != nil || status != http.StatusNoContent {
		t.Fatalf("repeated webhook = %d (err %v), want 204", status, err)
	}
	if got := len(consumeFor(t, brokers, paymentConfirmed, 1500*time.Millisecond)); got != 1 {
		t.Fatalf("%d billing.payment.confirmed.v1 events after the repeated webhook, want still 1", got)
	}

	// PAY-06: without the token nobody changes an invoice.
	contradiction, _ := json.Marshal(map[string]any{"chargeId": paid["pspTransactionId"], "reference": paid["id"], "status": "FAILED", "failureReason": "FRAUD"})
	if status, err := postWebhook(webhook, "", contradiction); err != nil || status != http.StatusUnauthorized {
		t.Fatalf("webhook without token = %d (err %v), want 401", status, err)
	}
	// PAY-08 and the edge cases: a contradiction is a 409 and an unknown invoice a 404.
	if status, err := postWebhook(webhook, testWebhookToken, contradiction); err != nil || status != http.StatusConflict {
		t.Fatalf("contradicting webhook = %d (err %v), want 409", status, err)
	}
	unknown, _ := json.Marshal(map[string]any{"chargeId": "ch_paid_x", "reference": uuid.NewString(), "status": "PAID"})
	if status, err := postWebhook(webhook, testWebhookToken, unknown); err != nil || status != http.StatusNotFound {
		t.Fatalf("webhook of an unknown invoice = %d (err %v), want 404", status, err)
	}
	if got := invoiceStatus(t, port, orderOne); got != "PAID" {
		t.Fatalf("the paid invoice is %s after the rejected webhooks, want PAID", got)
	}
}

// PAY-09 and PAY-10: a PSP that is down does not fail the invoice; it stays ISSUED and is charged when the PSP is back.
func TestAnInvoiceIsChargedWhenThePSPComesBack(t *testing.T) {
	psp := newFakePSP(t)
	psp.down.Store(true)
	port, _, producer := startCharging(t, psp)
	if err := producer.ProduceSync(context.Background(),
		orderEvent(confirmedTopic, "evt-1", orderOne, iphonesBody(orderOne, "AMAZON", 1)),
	).FirstErr(); err != nil {
		t.Fatal(err)
	}

	eventuallyWithin(t, 20*time.Second, "the first attempt", func() bool { return psp.requests.Load() >= 1 })
	// The defaults wait 200 ms and 400 ms between the three attempts of a round, so they all come within 3 s of the first. A service
	// wired with one attempt per round would need 6 s or more.
	eventuallyWithin(t, 3*time.Second, "the three attempts of the first round", func() bool { return psp.requests.Load() >= 3 })
	if got := invoiceStatus(t, port, orderOne); got != "ISSUED" {
		t.Fatalf("the invoice is %s while the PSP is down, want ISSUED", got)
	}

	psp.down.Store(false)
	eventuallyWithin(t, 20*time.Second, "the invoice to be paid once the PSP is back", func() bool { return invoiceStatus(t, port, orderOne) == "PAID" })
}

// REC-01 and REC-02: a charge whose webhook never comes is asked about once it has been pending for the window,
// and the answer is applied as the webhook would apply it, with the same events.
func TestAPaymentWhoseWebhookNeverArrivesIsReconciled(t *testing.T) {
	psp := newFakePSP(t)
	psp.silent.Store(true)
	port, brokers, producer := startCharging(t, psp, map[string]string{
		"RECONCILE_AFTER":    "1s",
		"RECONCILE_INTERVAL": "200ms",
	})
	if err := producer.ProduceSync(context.Background(),
		orderEvent(confirmedTopic, "evt-1", orderOne, iphonesBody(orderOne, "AMAZON", 1)),
		orderEvent(confirmedTopic, "evt-2", orderTwo, iphonesBody(orderTwo, "SHOPEE", 7)),
	).FirstErr(); err != nil {
		t.Fatal(err)
	}

	eventuallyWithin(t, 15*time.Second, "the charges to wait for a webhook that does not come", func() bool {
		return invoiceStatus(t, port, orderOne) == "PAYMENT_PENDING" && invoiceStatus(t, port, orderTwo) == "PAYMENT_PENDING"
	})
	eventuallyWithin(t, 20*time.Second, "the reconciliation to pay the first order", func() bool { return invoiceStatus(t, port, orderOne) == "PAID" })
	eventuallyWithin(t, 20*time.Second, "the reconciliation to fail the second order", func() bool { return invoiceStatus(t, port, orderTwo) == "PAYMENT_FAILED" })

	paid, _ := invoicesOf(t, port, orderOne)[0].(map[string]any)
	refused, _ := invoicesOf(t, port, orderTwo)[0].(map[string]any)
	if paid["paidAt"] == nil || paid["pspTransactionId"] != "ch_paid_"+paid["id"].(string) {
		t.Errorf("reconciled paid invoice = %v, want its charge and the time it was paid", paid)
	}
	if refused["failureReason"] != "INSUFFICIENT_FUNDS" || refused["failedAt"] == nil {
		t.Errorf("reconciled refused invoice = %v, want the reason of the PSP and the time it failed", refused)
	}
	if confirmed := consumeFor(t, brokers, paymentConfirmed, 2*time.Second); len(confirmed) != 1 || string(confirmed[0].Key) != paid["id"] {
		t.Errorf("billing.payment.confirmed.v1 events = %v, want exactly one, of the paid invoice", confirmed)
	}
	if failed := consumeFor(t, brokers, paymentFailed, 2*time.Second); len(failed) != 1 || string(failed[0].Key) != refused["id"] {
		t.Errorf("billing.payment.failed.v1 events = %v, want exactly one, of the refused invoice", failed)
	}
}

// REC-01: the reconciliation asks at RECONCILE_INTERVAL, and not at the pace of the payment worker.
func TestTheReconciliationAsksAtItsOwnInterval(t *testing.T) {
	psp := newFakePSP(t)
	psp.silent.Store(true)
	psp.pending.Store(true)
	port, _, producer := startCharging(t, psp, map[string]string{
		"RECONCILE_AFTER":    "200ms",
		"RECONCILE_INTERVAL": "500ms",
	})
	if err := producer.ProduceSync(context.Background(),
		orderEvent(confirmedTopic, "evt-1", orderOne, iphonesBody(orderOne, "AMAZON", 1)),
	).FirstErr(); err != nil {
		t.Fatal(err)
	}
	eventuallyWithin(t, 20*time.Second, "the reconciliation to ask about the charge", func() bool { return psp.queries.Load() >= 1 })

	before := psp.queries.Load()
	time.Sleep(3 * time.Second)
	asked := psp.queries.Load() - before

	// One round every 500 ms is about 6 in 3 s. At the 50 ms of the payment worker it would be about 60.
	if asked < 1 || asked > 12 {
		t.Fatalf("the PSP was asked %d times in 3 s, want about 6: one round every 500 ms", asked)
	}
	if got := invoiceStatus(t, port, orderOne); got != "PAYMENT_PENDING" {
		t.Fatalf("the invoice is %s while the PSP is still undecided, want PAYMENT_PENDING", got)
	}
}

// PAY-05: a charge the PSP refuses to create fails the invoice at once, with the code of the PSP and no charge id.
func TestAnInvoiceTheProviderRefusesToCreateFails(t *testing.T) {
	psp := newFakePSP(t)
	port, brokers, producer := startCharging(t, psp)
	if err := producer.ProduceSync(context.Background(),
		orderEvent(confirmedTopic, "evt-1", orderOne, orderBody(orderOne, "AMAZON", 1, "0.50", "0.50")),
	).FirstErr(); err != nil {
		t.Fatal(err)
	}

	eventuallyWithin(t, 15*time.Second, "the invoice to fail", func() bool { return invoiceStatus(t, port, orderOne) == "PAYMENT_FAILED" })

	refused, _ := invoicesOf(t, port, orderOne)[0].(map[string]any)
	if refused["failureReason"] != "AMOUNT_NOT_ALLOWED" || refused["pspTransactionId"] != nil || refused["failedAt"] == nil {
		t.Fatalf("refused invoice = %v, want AMOUNT_NOT_ALLOWED, no charge and the time it failed", refused)
	}
	failed := consume(t, brokers, paymentFailed, 1)
	if len(failed) != 1 || string(failed[0].Key) != refused["id"] {
		t.Fatalf("billing.payment.failed.v1 events = %v, want one keyed by the refused invoice", failed)
	}
	body := valueOf(t, failed[0])
	if _, hasCharge := body["pspTransactionId"]; hasCharge || body["reason"] != "AMOUNT_NOT_ALLOWED" || body["amount"] != 0.5 {
		t.Fatalf("billing.payment.failed.v1 = %v, want the reason AMOUNT_NOT_ALLOWED, 0.50 and no pspTransactionId", body)
	}
	if psp.requests.Load() != 1 {
		t.Errorf("the PSP received %d charge requests, want 1: a refusal is not retried", psp.requests.Load())
	}
}

// Edge case: while the circuit is open the service keeps issuing invoices from Kafka; it only does not call the PSP.
func TestInvoicesAreStillIssuedWhileTheCircuitIsOpen(t *testing.T) {
	psp := newFakePSP(t)
	psp.down.Store(true)
	port, _, producer := startCharging(t, psp)
	if err := producer.ProduceSync(context.Background(),
		orderEvent(confirmedTopic, "evt-1", orderOne, iphonesBody(orderOne, "AMAZON", 1)),
	).FirstErr(); err != nil {
		t.Fatal(err)
	}
	// Five failed attempts in a row open the circuit: three in the first round, two in the second.
	eventuallyWithin(t, 30*time.Second, "the five failed attempts that open the circuit", func() bool { return psp.requests.Load() >= 5 })
	opened := psp.requests.Load()

	if err := producer.ProduceSync(context.Background(),
		orderEvent(confirmedTopic, "evt-2", orderTwo, iphonesBody(orderTwo, "SHOPEE", 1)),
	).FirstErr(); err != nil {
		t.Fatal(err)
	}
	eventuallyWithin(t, 20*time.Second, "the invoice of the second order", func() bool { return invoiceStatus(t, port, orderTwo) == "ISSUED" })
	time.Sleep(1500 * time.Millisecond)

	if got := psp.requests.Load(); got != opened {
		t.Fatalf("the PSP received %d requests, want the %d of before: no call while the circuit is open", got, opened)
	}
}
