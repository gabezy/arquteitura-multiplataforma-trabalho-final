// Package system holds the adapters of the ports that read the machine: ids and the clock.
package system

import (
	"time"

	"github.com/google/uuid"
)

// UUIDGenerator creates random UUIDs.
type UUIDGenerator struct{}

func (UUIDGenerator) NewID() string { return uuid.NewString() }

// Clock reads the system clock in UTC.
type Clock struct{}

func (Clock) Now() time.Time { return time.Now().UTC() }
