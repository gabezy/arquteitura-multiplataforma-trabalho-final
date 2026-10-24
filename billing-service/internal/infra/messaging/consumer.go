package messaging

import (
	"context"
	"log/slog"
	"time"

	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/plugin/kotel"
	"go.opentelemetry.io/otel/trace"
)

const (
	initialRetryDelay = time.Second
	maxRetryDelay     = 30 * time.Second
)

// MessageHandler processes one message. See OrderEventHandler.Handle for what it returns.
type MessageHandler interface {
	Handle(ctx context.Context, message Message) error
}

// DeadLetter stores a message that can never be processed.
type DeadLetter interface {
	Publish(ctx context.Context, message Message, reason string) error
}

// OrderEventsConsumer reads the order topics and hands each message to the
// handler, one at a time. It commits an offset only after the message was
// processed or dead-lettered, so a crash or a failure never loses a message.
type OrderEventsConsumer struct {
	client  *kgo.Client
	tracer  *kotel.Tracer
	handler MessageHandler
	dead    DeadLetter
	logger  *slog.Logger
	sleep   func(ctx context.Context, delay time.Duration) error
}

func NewOrderEventsConsumer(client *kgo.Client, tracer *kotel.Tracer, handler MessageHandler, dead DeadLetter, logger *slog.Logger) *OrderEventsConsumer {
	return &OrderEventsConsumer{client: client, tracer: tracer, handler: handler, dead: dead, logger: logger, sleep: sleepContext}
}

// Run consumes until ctx ends and returns nil. The message in progress is not
// committed when the context ends, so it is delivered again to the next instance.
func (c *OrderEventsConsumer) Run(ctx context.Context) error {
	for {
		fetches := c.client.PollFetches(ctx)
		if ctx.Err() != nil {
			return nil
		}
		fetches.EachError(func(topic string, partition int32, err error) {
			c.logger.ErrorContext(ctx, "kafka fetch failed", "topic", topic, "partition", partition, "error", err.Error())
		})

		records := fetches.RecordIter()
		for !records.Done() {
			if err := c.processRecord(ctx, records.Next()); err != nil {
				return nil
			}
		}
	}
}

// processRecord handles a record inside a "process" span that continues the trace
// of the message, then commits its offset. It fails only when ctx ends.
func (c *OrderEventsConsumer) processRecord(ctx context.Context, record *kgo.Record) error {
	// The span comes from the trace headers of the record; ctx keeps its own cancellation.
	_, span := c.tracer.WithProcessSpan(record)
	defer span.End()
	ctx = trace.ContextWithSpan(ctx, span)

	if err := c.process(ctx, messageOf(record)); err != nil {
		return err
	}
	if err := c.client.CommitRecords(ctx, record); err != nil {
		c.logger.ErrorContext(ctx, "committing the offset failed; the message may be delivered again",
			"topic", record.Topic, "partition", record.Partition, "offset", record.Offset, "error", err.Error())
	}
	return nil
}

// process handles one message until it is done: processed, or sent to the dead
// letter when it can never succeed. A transient failure, of the handler or of
// the dead letter, is retried with a delay that starts at 1 s and doubles up to
// 30 s. It returns an error only when ctx ends, and then the caller must not commit.
func (c *OrderEventsConsumer) process(ctx context.Context, message Message) error {
	delay := initialRetryDelay
	for {
		err := c.handler.Handle(ctx, message)

		var unprocessable *UnprocessableError
		if asUnprocessable(err, &unprocessable) {
			c.logger.WarnContext(ctx, "order event sent to the dead letter",
				"topic", message.Topic, "partition", message.Partition, "offset", message.Offset, "reason", unprocessable.Reason)
			err = c.dead.Publish(ctx, message, unprocessable.Reason)
		}
		if err == nil {
			return nil
		}

		c.logger.WarnContext(ctx, "processing the order event failed, retrying",
			"topic", message.Topic, "partition", message.Partition, "offset", message.Offset, "retryIn", delay.String(), "error", err.Error())
		if err := c.sleep(ctx, delay); err != nil {
			return err
		}
		delay = min(delay*2, maxRetryDelay)
	}
}

func messageOf(record *kgo.Record) Message {
	headers := make([]Header, len(record.Headers))
	for i, header := range record.Headers {
		headers[i] = Header{Key: header.Key, Value: header.Value}
	}
	return Message{
		Topic:     record.Topic,
		Partition: record.Partition,
		Offset:    record.Offset,
		Key:       record.Key,
		Value:     record.Value,
		Headers:   headers,
	}
}

func sleepContext(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
