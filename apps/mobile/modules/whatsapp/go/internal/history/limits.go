// Package history admits a WhatsApp history sync batch: bounded download and
// decompression, bounded parsing, normalization of every supported message, and one
// atomic publication of the messages with the protocol changes they depend on.
package history

import (
	"errors"
	"fmt"
)

// Limits bound every resource of one batch before the next stage may allocate for it.
// The byte limits are the contract; the structural ones are v1 constants chosen
// from the observed shape of history chunks and proven by the tests of this package. They
// are not WhatsApp limits and bound the parser input, not the process memory (see README).
type Limits struct {
	// MaxInput bounds the downloaded or inline bytes, counted while they are received.
	MaxInput int64
	// MaxInflated bounds the decompressed protobuf, counted while it is produced.
	MaxInflated int64
	// MaxDepth bounds protobuf message nesting; the parser rejects deeper input.
	MaxDepth int
	// MaxConversations, MaxMessages, MaxMappings and MaxPushNames bound repeated records.
	MaxConversations int
	MaxMessages      int
	MaxMappings      int
	MaxPushNames     int
	// MaxRecordBytes bounds one conversation message record on the wire.
	MaxRecordBytes int
	// MaxEstimatedBytes bounds the estimated heap the parser would allocate (see cost.go), the
	// bound that actually limits memory; the byte limits only bound the input.
	MaxEstimatedBytes int64
}

func DefaultLimits() Limits {
	return Limits{
		MaxInput:          16 << 20,
		MaxInflated:       32 << 20,
		MaxDepth:          32,
		MaxConversations:  2048,
		MaxMessages:       20000,
		MaxMappings:       20000,
		MaxPushNames:      20000,
		MaxRecordBytes:    1 << 20,
		MaxEstimatedBytes: 160 << 20,
	}
}

// ErrLimit is wrapped by every refusal caused by a limit of this package; the public
// code is HISTORY_LIMIT_REACHED and the condition is not a transient network failure.
var ErrLimit = errors.New("history limit reached")

// ErrInvalid is wrapped by refusals of content that cannot be admitted and never will be.
var ErrInvalid = errors.New("history batch invalid")

// ErrUnavailable is wrapped when the remote batch is permanently gone or fails integrity.
var ErrUnavailable = errors.New("history batch unavailable")

// LimitError names the resource that was exceeded.
type LimitError struct {
	Resource string
	Limit    int64
}

func (e *LimitError) Error() string {
	return fmt.Sprintf("history %s exceeds %d", e.Resource, e.Limit)
}
func (e *LimitError) Is(target error) bool { return target == ErrLimit }

func limit(resource string, bound int64) error { return &LimitError{Resource: resource, Limit: bound} }
