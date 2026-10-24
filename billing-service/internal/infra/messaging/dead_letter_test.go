package messaging_test

import (
	"context"
	"strconv"
	"testing"
	"time"

	"github.com/twmb/franz-go/pkg/kfake"
	"github.com/twmb/franz-go/pkg/kgo"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/messaging"
)

// INV-06: the dead letter keeps the original message and says where it came from and why.
func TestKafkaDeadLetterPublishesTheOriginalMessageWithTheDLQHeaders(t *testing.T) {
	const dlqTopic = "billing.order-events.dlq"
	cluster, err := kfake.NewCluster(kfake.NumBrokers(1), kfake.SeedTopics(1, dlqTopic))
	if err != nil {
		t.Fatal(err)
	}
	defer cluster.Close()
	producer, err := kgo.NewClient(kgo.SeedBrokers(cluster.ListenAddrs()...))
	if err != nil {
		t.Fatal(err)
	}
	defer producer.Close()
	consumer, err := kgo.NewClient(kgo.SeedBrokers(cluster.ListenAddrs()...), kgo.ConsumeTopics(dlqTopic))
	if err != nil {
		t.Fatal(err)
	}
	defer consumer.Close()
	message := confirmedMessage(`{"orderId":"42"}`)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := messaging.NewKafkaDeadLetter(producer, dlqTopic).Publish(ctx, message, "orderId must be a UUID"); err != nil {
		t.Fatalf("Publish() error = %v", err)
	}

	fetches := consumer.PollFetches(ctx)
	if err := fetches.Err(); err != nil {
		t.Fatal(err)
	}
	records := fetches.Records()
	if len(records) != 1 {
		t.Fatalf("consumed %d records, want 1", len(records))
	}
	record := records[0]
	if record.Topic != dlqTopic || string(record.Key) != orderID || string(record.Value) != `{"orderId":"42"}` {
		t.Errorf("record = topic %q key %q value %q, want the original key and value on the dead letter topic", record.Topic, record.Key, record.Value)
	}
	headers := map[string]string{}
	for _, h := range record.Headers {
		headers[h.Key] = string(h.Value)
	}
	want := map[string]string{
		"ce_id":                  "evt-1",
		"ce_type":                confirmedTopic,
		"dlq-original-topic":     confirmedTopic,
		"dlq-original-partition": strconv.Itoa(1),
		"dlq-original-offset":    strconv.Itoa(42),
		"dlq-reason":             "orderId must be a UUID",
	}
	for key, value := range want {
		if headers[key] != value {
			t.Errorf("header %s = %q, want %q", key, headers[key], value)
		}
	}
}

func TestKafkaDeadLetterReportsAFailedPublish(t *testing.T) {
	cluster, err := kfake.NewCluster(kfake.NumBrokers(1)) // no dead letter topic and no auto-creation
	if err != nil {
		t.Fatal(err)
	}
	defer cluster.Close()
	client, err := kgo.NewClient(kgo.SeedBrokers(cluster.ListenAddrs()...), kgo.UnknownTopicRetries(0))
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := messaging.NewKafkaDeadLetter(client, "missing.dlq").Publish(ctx, confirmedMessage("{}"), "x"); err == nil {
		t.Fatal("Publish() error = nil, want the delivery error")
	}
}
