package history

import (
	"bytes"
	"compress/zlib"
	"context"
	"errors"
	"io"

	"go.mau.fi/whatsmeow"
)

// ReadLimited reads at most max bytes. It stops consuming its source one byte past the
// limit, so an endless or falsely declared stream never costs more than max+1 bytes.
func ReadLimited(r io.Reader, max int64) ([]byte, error) {
	data, err := readCapped(r, max)
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > max {
		return nil, limit("input", max)
	}
	return data, nil
}

// Inflate decompresses zlib data into at most max bytes. The limit applies while the output
// is produced, before any parser sees it: an expansion bomb stops at max+1 bytes.
func Inflate(src io.Reader, max int64) ([]byte, error) {
	reader, err := zlib.NewReader(src)
	if err != nil {
		return nil, errors.Join(ErrInvalid, err)
	}
	defer reader.Close()
	data, err := readCapped(reader, max)
	if err != nil {
		return nil, errors.Join(ErrInvalid, err)
	}
	if int64(len(data)) > max {
		return nil, limit("inflated size", max)
	}
	return data, nil
}

// readCapped reads up to max+1 bytes into a buffer whose capacity never exceeds max+1, so the
// transient copy while it grows is bounded by 1.5 times the limit and not by doubling past it.
func readCapped(r io.Reader, max int64) ([]byte, error) {
	ceiling := max + 1
	data := make([]byte, 0, min(ceiling, 64<<10))
	for int64(len(data)) < ceiling {
		if len(data) == cap(data) {
			grown := make([]byte, len(data), min(ceiling, int64(cap(data))*2))
			copy(grown, data)
			data = grown
		}
		n, err := r.Read(data[len(data):cap(data)])
		data = data[:len(data)+n]
		if err == io.EOF {
			return data, nil
		}
		if err != nil {
			return nil, err
		}
	}
	return data, nil
}

// Fetch obtains the decompressed protobuf of a notification. Inline payloads and downloads
// both count against MaxInput; the download is cut while it is received. download is
// whatsmeow's Download bound to the notification.
func Fetch(ctx context.Context, inline []byte, download func(context.Context) ([]byte, error), limits Limits) ([]byte, error) {
	data := inline
	if data == nil {
		var err error
		if data, err = download(whatsmeow.WithMediaDownloadLimit(ctx, limits.MaxInput)); err != nil {
			if errors.Is(err, whatsmeow.ErrMediaDownloadLimit) {
				return nil, limit("input", limits.MaxInput)
			}
			return nil, err
		}
	}
	if int64(len(data)) > limits.MaxInput {
		return nil, limit("input", limits.MaxInput)
	}
	return Inflate(bytes.NewReader(data), limits.MaxInflated)
}
