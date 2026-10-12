package history

import (
	"bytes"
	"compress/zlib"
	"context"
	"errors"
	"io"
	"testing"

	"go.mau.fi/whatsmeow"
)

// endless supplies bytes forever and counts how many were consumed.
type endless struct{ consumed int64 }

func (e *endless) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = 7
	}
	e.consumed += int64(len(p))
	return len(p), nil
}

func isLimit(t *testing.T, err error, resource string) {
	t.Helper()
	var limited *LimitError
	if !errors.Is(err, ErrLimit) || !errors.As(err, &limited) || limited.Resource != resource {
		t.Fatalf("want a %q limit, got %v", resource, err)
	}
}

// UT-HIS-05: the input limit applies while bytes are received, whatever the source declares.
func TestUTHIS05InputLimitStopsTheSource(t *testing.T) {
	source := &endless{}
	if _, err := ReadLimited(source, 1<<20); err == nil {
		t.Fatal("an endless input must fail")
	} else {
		isLimit(t, err, "input")
	}
	// one chunk of read-ahead at most, never the endless remainder
	if source.consumed > (1<<20)+64*1024 {
		t.Fatalf("consumed %d bytes past a 1 MiB limit", source.consumed)
	}
	exact, err := ReadLimited(bytes.NewReader(make([]byte, 100)), 100)
	if err != nil || len(exact) != 100 {
		t.Fatalf("exactly the limit is valid: %d %v", len(exact), err)
	}
	if _, err := ReadLimited(bytes.NewReader(make([]byte, 101)), 100); err == nil {
		t.Fatal("one byte over must fail")
	} else {
		isLimit(t, err, "input")
	}
}

// UT-HIS-05: decompression is cut while its output is produced, before any parser sees it.
func TestUTHIS05InflateStopsAnExpansionBomb(t *testing.T) {
	reader, writer := io.Pipe()
	produced := make(chan int64, 1)
	go func() {
		z := zlib.NewWriter(writer)
		zeros := make([]byte, 64*1024)
		var total int64
		for {
			n, err := z.Write(zeros)
			total += int64(n)
			if err != nil || total > 1<<30 { // the writer stops when the reader closes the pipe
				produced <- total
				return
			}
		}
	}()
	_, err := Inflate(reader, 1<<20)
	reader.CloseWithError(io.ErrClosedPipe)
	isLimit(t, err, "inflated size")
	if total := <-produced; total > 64<<20 {
		t.Fatalf("the bomb was read to %d bytes instead of being cut near the limit", total)
	}
	raw := bytes.Repeat([]byte{1}, 4096)
	got, err := Inflate(bytes.NewReader(deflate(t, raw)), 4096)
	if err != nil || !bytes.Equal(got, raw) {
		t.Fatalf("exactly the limit is valid: %v", err)
	}
	if _, err := Inflate(bytes.NewReader(deflate(t, raw)), 4095); err == nil {
		t.Fatal("one byte over must fail")
	}
	if _, err := Inflate(bytes.NewReader([]byte("not zlib")), 4096); !errors.Is(err, ErrInvalid) || errors.Is(err, ErrLimit) {
		t.Fatalf("corrupt data is invalid, not a limit: %v", err)
	}
}

// UT-HIS-05: Fetch counts inline and downloaded bytes, and hands the parser nothing past the limits.
func TestUTHIS05FetchBoundsInlineAndDownload(t *testing.T) {
	limits := Limits{MaxInput: 256, MaxInflated: 1024}
	small := deflate(t, bytes.Repeat([]byte{1}, 512))
	if int64(len(small)) > limits.MaxInput {
		t.Fatalf("fixture too large: %d", len(small))
	}
	downloaded := func(data []byte) func(context.Context) ([]byte, error) {
		return func(ctx context.Context) ([]byte, error) {
			if limit, ok := whatsmeow.MediaDownloadLimit(ctx); !ok || limit != limits.MaxInput {
				t.Fatalf("download must carry the input limit, got %d %v", limit, ok)
			}
			if int64(len(data)) > limits.MaxInput {
				return nil, whatsmeow.ErrMediaDownloadLimit
			}
			return data, nil
		}
	}
	if raw, err := Fetch(context.Background(), nil, downloaded(small), limits); err != nil || len(raw) != 512 {
		t.Fatalf("download within both limits: %d %v", len(raw), err)
	}
	if raw, err := Fetch(context.Background(), small, nil, limits); err != nil || len(raw) != 512 {
		t.Fatalf("inline within both limits: %d %v", len(raw), err)
	}
	_, err := Fetch(context.Background(), make([]byte, 257), nil, limits)
	isLimit(t, err, "input")
	_, err = Fetch(context.Background(), nil, downloaded(make([]byte, 257)), limits)
	isLimit(t, err, "input")
	bomb := deflate(t, make([]byte, 1025))
	_, err = Fetch(context.Background(), nil, downloaded(bomb), limits)
	isLimit(t, err, "inflated size")
	boom := errors.New("network down")
	if _, err := Fetch(context.Background(), nil, func(context.Context) ([]byte, error) { return nil, boom }, limits); !errors.Is(err, boom) || errors.Is(err, ErrLimit) {
		t.Fatalf("a network fault is not a limit: %v", err)
	}
}

// UT-HIS-06: input, inflated and recovery budgets are separate constants with separate errors.
func TestUTHIS06BudgetsAreIndependent(t *testing.T) {
	limits := DefaultLimits()
	if limits.MaxInput != 16<<20 || limits.MaxInflated != 32<<20 {
		t.Fatalf("byte limits drifted: %d %d", limits.MaxInput, limits.MaxInflated)
	}
	input := limit("input", limits.MaxInput)
	inflated := limit("inflated size", limits.MaxInflated)
	var a, b *LimitError
	if !errors.As(input, &a) || !errors.As(inflated, &b) || a.Resource == b.Resource || a.Limit == b.Limit {
		t.Fatal("each restriction names itself and its own bound")
	}
	// a payload under 16 MiB that inflates past 32 MiB fails on the inflated limit, not the input one
	small := Limits{MaxInput: 64, MaxInflated: 128}
	payload := deflate(t, make([]byte, 129))
	if int64(len(payload)) > small.MaxInput {
		t.Fatalf("fixture too large: %d", len(payload))
	}
	_, err := Fetch(context.Background(), payload, nil, small)
	isLimit(t, err, "inflated size")
}
