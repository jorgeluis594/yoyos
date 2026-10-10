// Package images downloads, verifies, reuses and deletes private WhatsApp images under one
// global byte budget. It knows nothing about whatsmeow: the network arrives through Network.
package images

import (
	"errors"
	"fmt"
)

// Code is a public WhatsApp error code.
type Code string

const (
	InvalidInput        Code = "INVALID_INPUT"
	ImageUnavailable    Code = "IMAGE_UNAVAILABLE"
	AccountNotConnected Code = "ACCOUNT_NOT_CONNECTED"
	StorageLimitReached Code = "STORAGE_LIMIT_REACHED"
	DownloadFailed      Code = "IMAGE_DOWNLOAD_FAILED"
	DeleteFailed        Code = "IMAGE_DELETE_FAILED"
)

// Error carries a public code and, for tests and logs, an internal cause that never holds
// descriptors or keys.
type Error struct {
	Code  Code
	Cause error
}

func (e *Error) Error() string {
	if e.Cause == nil {
		return string(e.Code)
	}
	return fmt.Sprintf("%s: %v", e.Code, e.Cause)
}
func (e *Error) Unwrap() error { return e.Cause }

func fail(code Code, cause error) *Error { return &Error{Code: code, Cause: cause} }

// CodeOf maps any error to its public code; unexpected errors are download failures.
func CodeOf(err error) Code {
	var typed *Error
	if errors.As(err, &typed) {
		return typed.Code
	}
	return DownloadFailed
}

var (
	// ErrNotConnected is returned by Network when no live generation serves the account.
	ErrNotConnected = errors.New("account is not connected")
	// ErrRetired is returned by Lease.Publish when the generation was retired first.
	ErrRetired = errors.New("generation was retired")
	// ErrGone is returned by a download when the remote resource expired or is no longer served.
	ErrGone = errors.New("remote image is gone")
	// ErrCorrupt is returned by a download whose integrity check failed.
	ErrCorrupt = errors.New("downloaded image failed its integrity check")
	// ErrLimit is raised by a limited file when a write would pass the budget.
	ErrLimit   = errors.New("image storage limit reached")
	errTimeout = errors.New("image operation timed out")
)
