package images

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// m2: leftovers in subdirectories count against the global budget.
func TestSubdirectoriesCountAgainstTheBudget(t *testing.T) {
	dir := t.TempDir()
	nested := filepath.Join(dir, "leftover", "deeper")
	if err := os.MkdirAll(nested, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(nested, "x"), make([]byte, 70), 0o600); err != nil {
		t.Fatal(err)
	}
	service := openService(t, dir, 100, nil, nil, newNetwork(serving(payload(40))))
	if got := service.Stats().UsedBytes; got != 70 {
		t.Fatalf("subdirectory bytes ignored: %d", got)
	}
	id, ref, _ := reference(t, spec{wid: "s", plain: payload(40)})
	_, err := service.Download(id, ref)
	wantCode(t, err, StorageLimitReached)
}

// m3: BMP needs a real header, not just the magic.
func TestBMPDetectionValidatesTheHeader(t *testing.T) {
	good := make([]byte, 32)
	copy(good, "BM")
	good[14] = 40
	if sniffMIME(good) != "image/bmp" {
		t.Fatal("valid BMP header rejected")
	}
	for name, mutate := range map[string]func([]byte){
		"magic only":  func(b []byte) { clear(b[2:]) },
		"reserved":    func(b []byte) { b[7] = 1 },
		"unknown dib": func(b []byte) { b[14] = 41 },
	} {
		bad := append([]byte{}, good...)
		mutate(bad)
		if sniffMIME(bad) != "" {
			t.Fatalf("%s accepted as BMP", name)
		}
	}
	if sniffMIME([]byte("BM text file, not an image at all")) != "" {
		t.Fatal("text starting with BM accepted")
	}
}

// m4: the temporary name is unpredictable and an explicit delete removes a stuck one.
func TestPartialNamesAreUnpredictableAndStuckOnesAreDeletable(t *testing.T) {
	dir := t.TempDir()
	filesystem := &faultyFS{}
	var seen []string
	network := newNetwork(func(_ context.Context, _ Descriptor, f File) error {
		entries, _ := os.ReadDir(dir)
		for _, e := range entries {
			seen = append(seen, e.Name())
		}
		_, _ = f.Write(bytes.Repeat([]byte{1}, 50))
		return context.DeadlineExceeded
	})
	service := openService(t, dir, 1<<20, filesystem, nil, network)
	id, ref, _ := reference(t, spec{wid: "n", plain: payload(40)})
	for i := 0; i < 2; i++ {
		_, _ = service.Download(id, ref)
	}
	if len(seen) != 2 || seen[0] == seen[1] || !strings.HasSuffix(seen[0], partialSuffix) || seen[0] == fileName(id)+partialSuffix {
		t.Fatalf("partial names %v", seen)
	}
	filesystem.setRemove(func(path string) error {
		if _, err := os.Stat(path); err == nil && strings.HasSuffix(path, partialSuffix) {
			return permission(path)
		}
		return nil
	})
	_, _ = service.Download(id, ref)
	if service.Stats().UsedBytes != 50 {
		t.Fatalf("stuck partial not counted: %+v", service.Stats())
	}
	filesystem.setRemove(nil)
	if err := service.Delete(id); err != nil || service.Stats().UsedBytes != 0 || len(files(t, dir)) != 0 {
		t.Fatalf("explicit delete left the stuck partial: %v %+v %v", err, service.Stats(), files(t, dir))
	}
}

// M3 / UT-IMG-14 / IT-IMG-14: admission order is the order of the Begin calls, whatever order the
// waiting threads run in, so download(X) followed by delete(X) never inverts.
func TestM3AdmissionOrderIsFixedByBeginNotByWait(t *testing.T) {
	plain := payload(128)
	id, ref, _ := reference(t, spec{wid: "order", plain: plain})
	for round := 0; round < 20; round++ {
		dir := t.TempDir()
		service := openService(t, dir, 1<<20, nil, nil, newNetwork(serving(plain)))
		download := service.BeginDownload(id, ref)
		remove := service.BeginDelete(id)
		// The waiters arrive in the opposite order, as unordered native threads could.
		deleted := make(chan *Error, 1)
		go func() { _, err := remove.Wait(); deleted <- err }()
		time.Sleep(2 * time.Millisecond)
		if _, err := download.Wait(); err != nil {
			t.Fatal(err)
		}
		if err := <-deleted; err != nil {
			t.Fatal(err)
		}
		if names := files(t, dir); len(names) != 0 || service.Stats().UsedBytes != 0 {
			t.Fatalf("round %d: the delete overtook the download and left %v", round, names)
		}
	}
	// Delete admitted first, download second: the download publishes afterwards.
	dir := t.TempDir()
	service := openService(t, dir, 1<<20, nil, nil, newNetwork(serving(plain)))
	remove := service.BeginDelete(id)
	download := service.BeginDownload(id, ref)
	removed := make(chan *Error, 1)
	go func() { _, err := remove.Wait(); removed <- err }() // every admitted operation must be waited for
	if _, err := download.Wait(); err != nil {
		t.Fatal(err)
	}
	if err := <-removed; err != nil {
		t.Fatal(err)
	}
	if len(files(t, dir)) != 1 {
		t.Fatal("a download admitted after the delete must stay published")
	}
}

// m7: an unreadable foreign entry degrades the accounting, it does not stop initialization.
func TestM7UnreadableForeignEntriesDoNotFailOpen(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{"bad", "good"} {
		if err := os.MkdirAll(filepath.Join(dir, name, "inner"), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "good", "inner", "x"), make([]byte, 33), 0o600); err != nil {
		t.Fatal(err)
	}
	filesystem := &faultyFS{dirError: func(path string) error {
		if filepath.Base(path) == "bad" {
			return permission(path)
		}
		return nil
	}}
	service, err := Open(Options{Dir: dir, LimitBytes: 1 << 20, FS: filesystem})
	if err != nil {
		t.Fatalf("one unreadable subdirectory stopped initialization: %v", err)
	}
	stats := service.Stats()
	if stats.UsedBytes != 33 || stats.Unreadable != 1 || stats.Files != 0 {
		t.Fatalf("%+v", stats)
	}
}
