package app_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
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
	reportDelay         = 100 * time.Millisecond
	paymentPollInterval = "50ms"
)

// fakePSP answers like the WireMock mappings of docker/wiremock: it accepts every charge with 201 PENDING and,
// a moment later, reports PAID by webhook, or FAILED for a charge of R$ 100.000,00 or more.
type fakePSP struct {
	server   *httptest.Server
	requests atomic.Int32
	down     atomic.Bool
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
		id, status, reason := "ch_paid_"+charge.Reference, "PAID", any(nil)
		if charge.Amount >= insufficientFunds {
			id, status, reason = "ch_failed_"+charge.Reference, "FAILED", "INSUFFICIENT_FUNDS"
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{"id": id, "reference": charge.Reference, "status": "PENDING"})

		go func() {
			time.Sleep(reportDelay)
			body, _ := json.Marshal(map[string]any{
				"chargeId": id, "reference": charge.Reference, "status": status, "failureReason": reason,
				"occurredAt": time.Now().UTC().Format(time.RFC3339),
			})
			_, _ = postWebhook(charge.CallbackURL, testWebhookToken, body)
		}()
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
	total := strconv.Itoa(n*15000) + ".00"
	return `{"orderId":"` + orderID + `","marketplace":"` + marketplace + `","externalOrderId":"EXT-` + orderID[len(orderID)-1:] + `",` +
		`"items":[{"sku":"231","quantity":` + strconv.Itoa(n) + `,"unitPrice":15000.00}],"total":` + total + `}`
}

// startCharging runs the service with the fake PSP, a payment round every 50 ms, and the webhook pointed at itself.
func startCharging(t *testing.T, psp *fakePSP) (cfgPort int, brokers []string, producer *kgo.Client) {
	t.Helper()
	cluster, err := kfake.NewCluster(kfake.NumBrokers(1), kfake.SeedTopics(1,
		confirmedTopic, cancelledTopic, issuedTopic, deadLetter, paymentConfirmed, paymentFailed))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(cluster.Close)
	brokers = cluster.ListenAddrs()
	port := freePort(t)
	cfg := testConfigWith(t, testsupport.NewDatabase(t), brokers, map[string]string{
		"PORT":                  strconv.Itoa(port),
		"PSP_BASE_URL":          psp.server.URL,
		"PSP_CALLBACK_URL":      "http://127.0.0.1:" + strconv.Itoa(port) + "/webhooks/psp",
		"PAYMENT_POLL_INTERVAL": paymentPollInterval,
	})
	_, done := start(t, cfg)
	waitUntilHealthy(t, cfg.Port, done)

	producer, err = kgo.NewClient(kgo.SeedBrokers(brokers...))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(producer.Close)
	return cfg.Port, brokers, producer
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

	eventually(t, "the first order to be paid", func() bool { return invoiceStatus(t, port, orderOne) == "PAID" })
	eventually(t, "the second order to be refused", func() bool { return invoiceStatus(t, port, orderTwo) == "PAYMENT_FAILED" })

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

	eventually(t, "the three attempts of the first round", func() bool { return psp.requests.Load() >= 3 })
	if got := invoiceStatus(t, port, orderOne); got != "ISSUED" {
		t.Fatalf("the invoice is %s while the PSP is down, want ISSUED", got)
	}

	psp.down.Store(false)
	eventually(t, "the invoice to be paid once the PSP is back", func() bool { return invoiceStatus(t, port, orderOne) == "PAID" })
}
