package outbox_test

import (
	"context"
	"testing"
	"time"

	"github.com/twmb/franz-go/pkg/kfake"
	"github.com/twmb/franz-go/pkg/kgo"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/outbox"
)

// BOOT-10: the Kafka adapter sends the topic, key, value and headers of the record.
func TestKafkaProducerSendsTopicKeyValueAndHeaders(t *testing.T) {
	const topic = "billing.invoice.issued.v1"
	cluster, err := kfake.NewCluster(kfake.NumBrokers(1), kfake.SeedTopics(1, topic))
	if err != nil {
		t.Fatal(err)
	}
	defer cluster.Close()

	producerClient, err := kgo.NewClient(kgo.SeedBrokers(cluster.ListenAddrs()...))
	if err != nil {
		t.Fatal(err)
	}
	defer producerClient.Close()
	consumerClient, err := kgo.NewClient(kgo.SeedBrokers(cluster.ListenAddrs()...), kgo.ConsumeTopics(topic))
	if err != nil {
		t.Fatal(err)
	}
	defer consumerClient.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	err = outbox.NewKafkaProducer(producerClient).Produce(ctx, outbox.Record{
		Topic: topic,
		Key:   "0a2e6a54-8d0c-4a63-a5d3-6e0f1c9a2b10",
		Value: []byte(`{"invoiceId":"0a2e6a54-8d0c-4a63-a5d3-6e0f1c9a2b10"}`),
		Headers: []outbox.Header{
			{Key: "ce_type", Value: topic},
			{Key: "content-type", Value: "application/json"},
		},
	})
	if err != nil {
		t.Fatalf("Produce() error = %v", err)
	}

	fetches := consumerClient.PollFetches(ctx)
	if err := fetches.Err(); err != nil {
		t.Fatal(err)
	}
	records := fetches.Records()
	if len(records) != 1 {
		t.Fatalf("consumed %d records, want 1", len(records))
	}
	record := records[0]
	if record.Topic != topic || string(record.Key) != "0a2e6a54-8d0c-4a63-a5d3-6e0f1c9a2b10" {
		t.Errorf("record = topic %q key %q, want topic %q and the invoice id as key", record.Topic, record.Key, topic)
	}
	if string(record.Value) != `{"invoiceId":"0a2e6a54-8d0c-4a63-a5d3-6e0f1c9a2b10"}` {
		t.Errorf("value = %s", record.Value)
	}
	headers := map[string]string{}
	for _, h := range record.Headers {
		headers[h.Key] = string(h.Value)
	}
	if headers["ce_type"] != topic || headers["content-type"] != "application/json" {
		t.Errorf("headers = %v, want ce_type %s and content-type application/json", headers, topic)
	}
}

func TestKafkaProducerReportsAFailedDelivery(t *testing.T) {
	cluster, err := kfake.NewCluster(kfake.NumBrokers(1)) // no topic and no auto-creation
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
	err = outbox.NewKafkaProducer(client).Produce(ctx, outbox.Record{Topic: "missing.topic.v1", Key: "k", Value: []byte("{}")})

	if err == nil {
		t.Fatal("Produce() error = nil, want the delivery error")
	}
}
