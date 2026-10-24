// Package messaging holds the Kafka adapters: the client, the CloudEvents
// translation, the consumers and the dead letter publisher.
package messaging

import (
	"fmt"

	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/plugin/kotel"
)

const clientID = "billing-service"

// NewProducerClient builds the client that publishes the outbox events. The
// kotel hooks start the produce spans and inject the traceparent header into
// each record, using the global tracer provider and propagator.
func NewProducerClient(brokers []string) (*kgo.Client, error) {
	client, err := kgo.NewClient(
		kgo.SeedBrokers(brokers...),
		kgo.ClientID(clientID),
		kgo.WithHooks(tracingHooks()...),
	)
	if err != nil {
		return nil, fmt.Errorf("create kafka producer client: %w", err)
	}
	return client, nil
}

// NewConsumerClient builds the client of the order consumer: one consumer group,
// manual commits and, for a group that has no offset yet, the start of the topic.
// The returned tracer starts the "process" span of each message.
func NewConsumerClient(brokers []string, group string, topics ...string) (*kgo.Client, *kotel.Tracer, error) {
	tracer := kotel.NewTracer()
	client, err := kgo.NewClient(
		kgo.SeedBrokers(brokers...),
		kgo.ClientID(clientID),
		kgo.ConsumerGroup(group),
		kgo.ConsumeTopics(topics...),
		kgo.DisableAutoCommit(),
		kgo.ConsumeResetOffset(kgo.NewOffset().AtStart()),
		kgo.WithHooks(kotel.NewKotel(kotel.WithTracer(tracer)).Hooks()...),
	)
	if err != nil {
		return nil, nil, fmt.Errorf("create kafka consumer client: %w", err)
	}
	return client, tracer, nil
}

func tracingHooks() []kgo.Hook {
	return kotel.NewKotel(kotel.WithTracer(kotel.NewTracer()), kotel.WithMeter(kotel.NewMeter())).Hooks()
}
