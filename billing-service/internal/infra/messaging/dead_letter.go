package messaging

import (
	"context"
	"strconv"

	"github.com/twmb/franz-go/pkg/kgo"
)

// KafkaDeadLetter publishes the messages that can never be processed to a dead letter topic.
type KafkaDeadLetter struct {
	client *kgo.Client
	topic  string
}

func NewKafkaDeadLetter(client *kgo.Client, topic string) *KafkaDeadLetter {
	return &KafkaDeadLetter{client: client, topic: topic}
}

// Publish sends the original key, value and headers, plus where the message came
// from and why it was rejected, and waits for the broker acknowledgement.
func (d *KafkaDeadLetter) Publish(ctx context.Context, message Message, reason string) error {
	headers := make([]kgo.RecordHeader, 0, len(message.Headers)+4)
	for _, header := range message.Headers {
		headers = append(headers, kgo.RecordHeader{Key: header.Key, Value: header.Value})
	}
	headers = append(headers,
		kgo.RecordHeader{Key: "dlq-original-topic", Value: []byte(message.Topic)},
		kgo.RecordHeader{Key: "dlq-original-partition", Value: []byte(strconv.FormatInt(int64(message.Partition), 10))},
		kgo.RecordHeader{Key: "dlq-original-offset", Value: []byte(strconv.FormatInt(message.Offset, 10))},
		kgo.RecordHeader{Key: "dlq-reason", Value: []byte(reason)},
	)
	record := &kgo.Record{Topic: d.topic, Key: message.Key, Value: message.Value, Headers: headers, Context: ctx}
	return d.client.ProduceSync(ctx, record).FirstErr()
}
