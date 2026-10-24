package app_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"testing"
	"time"

	"github.com/twmb/franz-go/pkg/kfake"
	"github.com/twmb/franz-go/pkg/kgo"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/testsupport"
)

const (
	confirmedTopic = "order.order.confirmed.v1"
	cancelledTopic = "order.order.cancelled.v1"
	issuedTopic    = "billing.invoice.issued.v1"
	deadLetter     = "billing.order-events.dlq"

	orderOne   = "6f1c2b8e-0000-4000-8000-000000000001"
	orderTwo   = "6f1c2b8e-0000-4000-8000-000000000002"
	orderThree = "6f1c2b8e-0000-4000-8000-000000000003"
)

func orderEvent(topic, ceID, key, body string) *kgo.Record {
	return &kgo.Record{
		Topic: topic,
		Key:   []byte(key),
		Value: []byte(body),
		Headers: []kgo.RecordHeader{
			{Key: "ce_specversion", Value: []byte("1.0")},
			{Key: "ce_id", Value: []byte(ceID)},
			{Key: "ce_source", Value: []byte("/order-service")},
			{Key: "ce_type", Value: []byte(topic)},
		},
	}
}

func confirmedBody(orderID, marketplace string, total string) string {
	return `{"orderId":"` + orderID + `","marketplace":"` + marketplace + `","externalOrderId":"EXT-` + orderID[len(orderID)-1:] + `",` +
		`"items":[{"sku":"231","quantity":1,"unitPrice":15000.00}],"total":` + total + `}`
}

func getJSON(t *testing.T, target string) (int, map[string]any) {
	t.Helper()
	response, err := http.Get(target)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = response.Body.Close() }()
	raw, _ := io.ReadAll(response.Body)
	var body map[string]any
	_ = json.Unmarshal(raw, &body)
	return response.StatusCode, body
}

// invoicesOf lists the invoices of an order through the API.
func invoicesOf(t *testing.T, port int, orderID string) []any {
	t.Helper()
	_, body := getJSON(t, "http://127.0.0.1:"+strconv.Itoa(port)+"/invoices?"+url.Values{"orderId": {orderID}}.Encode())
	invoices, _ := body["invoices"].([]any)
	return invoices
}

func eventually(t *testing.T, what string, condition func() bool) {
	t.Helper()
	eventuallyWithin(t, 45*time.Second, what, condition)
}

// eventuallyWithin is eventually with a limit that says how long the thing is allowed to take, so that a
// slow wiring (a worker on the wrong interval) fails the test instead of passing slowly.
func eventuallyWithin(t *testing.T, limit time.Duration, what string, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(limit)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

// consume reads every record of a topic that exists in the in-memory cluster until it has n of them or times out.
func consume(t *testing.T, brokers []string, topic string, n int) []*kgo.Record {
	t.Helper()
	client, err := kgo.NewClient(kgo.SeedBrokers(brokers...), kgo.ConsumeTopics(topic), kgo.ConsumeResetOffset(kgo.NewOffset().AtStart()))
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	var records []*kgo.Record
	for len(records) < n {
		fetches := client.PollFetches(ctx)
		if ctx.Err() != nil {
			break
		}
		fetches.EachRecord(func(r *kgo.Record) { records = append(records, r) })
	}
	return records
}

func headerOf(record *kgo.Record, key string) string {
	for _, h := range record.Headers {
		if h.Key == key {
			return string(h.Value)
		}
	}
	return ""
}

// INV-01 to INV-11 through the whole service: Kafka in, Postgres, Kafka out, and the API.
func TestOrderEventsBecomeInvoicesThroughTheWholeService(t *testing.T) {
	cluster, err := kfake.NewCluster(kfake.NumBrokers(1), kfake.SeedTopics(1, confirmedTopic, cancelledTopic, issuedTopic, deadLetter))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(cluster.Close)
	brokers := cluster.ListenAddrs()
	cfg := testConfig(t, testsupport.NewDatabase(t), brokers)
	_, done := start(t, cfg)
	waitUntilHealthy(t, cfg.Port, done)

	producer, err := kgo.NewClient(kgo.SeedBrokers(brokers...))
	if err != nil {
		t.Fatal(err)
	}
	defer producer.Close()
	ctx := context.Background()
	send := func(records ...*kgo.Record) {
		t.Helper()
		if err := producer.ProduceSync(ctx, records...).FirstErr(); err != nil {
			t.Fatal(err)
		}
	}

	// INV-01, INV-02: one iPhone sold on Mercado Livre becomes an invoice with the 11% commission.
	send(orderEvent(confirmedTopic, "evt-1", orderOne, confirmedBody(orderOne, "MERCADO_LIVRE", "15000.00")))
	eventually(t, "the invoice of the first order", func() bool { return len(invoicesOf(t, cfg.Port, orderOne)) == 1 })
	first, _ := invoicesOf(t, cfg.Port, orderOne)[0].(map[string]any)
	if first["status"] != "ISSUED" || first["amount"] != 15000.0 || first["commissionPercent"] != 11.0 ||
		first["commissionAmount"] != 1650.0 || first["netAmount"] != 13350.0 || first["marketplace"] != "MERCADO_LIVRE" {
		t.Fatalf("invoice = %v, want ISSUED, 15000.00, 11.00%%, 1650.00 and 13350.00 on MERCADO_LIVRE", first)
	}
	status, byID := getJSON(t, "http://127.0.0.1:"+strconv.Itoa(cfg.Port)+"/invoices/"+first["id"].(string))
	if status != http.StatusOK || byID["orderId"] != orderOne {
		t.Fatalf("GET /invoices/{id} = %d %v, want 200 with the order", status, byID)
	}

	// INV-04, INV-05: the same event, and another event of the same order, change nothing.
	// INV-06: a total that does not match the items is dead-lettered.
	// Another order closes the batch: the partition is ordered, so once it shows up the messages before it were handled.
	send(
		orderEvent(confirmedTopic, "evt-1", orderOne, confirmedBody(orderOne, "MERCADO_LIVRE", "15000.00")),
		orderEvent(confirmedTopic, "evt-1b", orderOne, confirmedBody(orderOne, "MERCADO_LIVRE", "15000.00")),
		orderEvent(confirmedTopic, "evt-bad", orderThree, confirmedBody(orderThree, "AMAZON", "1.00")),
		orderEvent(confirmedTopic, "evt-2", orderTwo, confirmedBody(orderTwo, "SHOPEE", "15000.00")),
	)
	eventually(t, "the invoice of the second order", func() bool { return len(invoicesOf(t, cfg.Port, orderTwo)) == 1 })
	if got := len(invoicesOf(t, cfg.Port, orderOne)); got != 1 {
		t.Fatalf("the first order has %d invoices after the redeliveries, want 1", got)
	}
	if got := len(invoicesOf(t, cfg.Port, orderThree)); got != 0 {
		t.Fatalf("the order with a wrong total has %d invoices, want none", got)
	}
	second, _ := invoicesOf(t, cfg.Port, orderTwo)[0].(map[string]any)
	if second["commissionAmount"] != 2100.0 || second["netAmount"] != 12900.0 {
		t.Fatalf("Shopee invoice = %v, want 14%% commission of 2100.00 and 12900.00 net", second)
	}

	// INV-03: one billing.invoice.issued.v1 per invoice, keyed by the invoice id, with CloudEvents headers.
	issued := consume(t, brokers, issuedTopic, 2)
	if len(issued) != 2 {
		t.Fatalf("published %d billing.invoice.issued.v1 events, want 2: one per invoice and none for the redeliveries", len(issued))
	}
	keys := map[string]bool{string(issued[0].Key): true, string(issued[1].Key): true}
	if !keys[first["id"].(string)] || !keys[second["id"].(string)] {
		t.Fatalf("event keys = %v, want the ids of the two invoices", keys)
	}
	if headerOf(issued[0], "ce_type") != issuedTopic || headerOf(issued[0], "ce_source") != "/billing-service" {
		t.Errorf("headers ce_type/ce_source = %q/%q, want %s and /billing-service", headerOf(issued[0], "ce_type"), headerOf(issued[0], "ce_source"), issuedTopic)
	}

	dead := consume(t, brokers, deadLetter, 1)
	if len(dead) != 1 || string(dead[0].Key) != orderThree || headerOf(dead[0], "dlq-original-topic") != confirmedTopic || headerOf(dead[0], "dlq-reason") == "" {
		t.Fatalf("dead letters = %v, want the order with the wrong total, with its origin and reason", dead)
	}

	// INV-08: a cancellation cancels the invoice that is still unpaid.
	send(orderEvent(cancelledTopic, "evt-3", orderOne, `{"orderId":"`+orderOne+`","reason":"OUT_OF_STOCK"}`))
	eventually(t, "the cancellation of the first invoice", func() bool {
		invoices := invoicesOf(t, cfg.Port, orderOne)
		return len(invoices) == 1 && invoices[0].(map[string]any)["status"] == "CANCELLED"
	})
	cancelled, _ := invoicesOf(t, cfg.Port, orderOne)[0].(map[string]any)
	if cancelled["cancellationReason"] != "OUT_OF_STOCK" || cancelled["cancelledAt"] == nil {
		t.Fatalf("cancelled invoice = %v, want the reason and the time", cancelled)
	}
}

// INV-09 and INV-10: the cancellation arrived first, so the confirmation that follows creates no invoice.
func TestAConfirmationAfterItsCancellationCreatesNoInvoice(t *testing.T) {
	cluster, err := kfake.NewCluster(kfake.NumBrokers(1), kfake.SeedTopics(1, confirmedTopic, cancelledTopic, issuedTopic, deadLetter))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(cluster.Close)
	brokers := cluster.ListenAddrs()
	cfg := testConfig(t, testsupport.NewDatabase(t), brokers)
	_, done := start(t, cfg)
	waitUntilHealthy(t, cfg.Port, done)
	producer, err := kgo.NewClient(kgo.SeedBrokers(brokers...))
	if err != nil {
		t.Fatal(err)
	}
	defer producer.Close()
	ctx := context.Background()

	if err := producer.ProduceSync(ctx, orderEvent(cancelledTopic, "evt-c", orderOne, `{"orderId":"`+orderOne+`"}`)).FirstErr(); err != nil {
		t.Fatal(err)
	}
	// The cancelled topic has its own partition, so give the consumer the time to record it before the confirmation arrives.
	time.Sleep(3 * time.Second)
	if err := producer.ProduceSync(ctx,
		orderEvent(confirmedTopic, "evt-k", orderOne, confirmedBody(orderOne, "AMAZON", "15000.00")),
		orderEvent(confirmedTopic, "evt-k2", orderTwo, confirmedBody(orderTwo, "AMAZON", "15000.00")),
	).FirstErr(); err != nil {
		t.Fatal(err)
	}

	eventually(t, "the invoice of the control order", func() bool { return len(invoicesOf(t, cfg.Port, orderTwo)) == 1 })
	if got := len(invoicesOf(t, cfg.Port, orderOne)); got != 0 {
		t.Fatalf("the cancelled order has %d invoices, want none", got)
	}
}
