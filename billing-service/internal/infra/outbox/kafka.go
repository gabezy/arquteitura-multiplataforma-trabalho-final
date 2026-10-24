package outbox

import (
	"context"

	"github.com/twmb/franz-go/pkg/kgo"
)

// KafkaProducer is the Producer backed by a franz-go client.
type KafkaProducer struct {
	client *kgo.Client
}

func NewKafkaProducer(client *kgo.Client) *KafkaProducer {
	return &KafkaProducer{client: client}
}

// Produce sends the record and waits for the broker acknowledgement. The record
// carries ctx, so the tracing hooks of the client continue the trace in ctx.
func (p *KafkaProducer) Produce(ctx context.Context, record Record) error {
	headers := make([]kgo.RecordHeader, len(record.Headers))
	for i, header := range record.Headers {
		headers[i] = kgo.RecordHeader{Key: header.Key, Value: []byte(header.Value)}
	}
	message := &kgo.Record{
		Topic:   record.Topic,
		Key:     []byte(record.Key),
		Value:   record.Value,
		Headers: headers,
		Context: ctx,
	}
	return p.client.ProduceSync(ctx, message).FirstErr()
}
