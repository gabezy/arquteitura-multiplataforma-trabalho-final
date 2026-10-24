package messaging

import "errors"

// Header is one Kafka record header.
type Header struct {
	Key   string
	Value []byte
}

// Message is a Kafka record, apart from the client library.
type Message struct {
	Topic     string
	Partition int32
	Offset    int64
	Key       []byte
	Value     []byte
	Headers   []Header
}

// UnprocessableError says that a message can never be processed, however often
// it is delivered: it breaks the contract, or the core rejected its content.
// The consumer sends it to the dead letter topic. Any other error is transient
// and the message is processed again.
type UnprocessableError struct {
	Reason string
}

func (e *UnprocessableError) Error() string { return e.Reason }

// headerValues indexes the headers by name. The last value of a repeated header wins.
func headerValues(headers []Header) map[string]string {
	values := make(map[string]string, len(headers))
	for _, header := range headers {
		values[header.Key] = string(header.Value)
	}
	return values
}

func asUnprocessable(err error, target **UnprocessableError) bool {
	return errors.As(err, target)
}
