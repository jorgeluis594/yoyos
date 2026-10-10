package images

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// UT-IMG-09: real bytes and reservations are bounded on every file operation.
func TestUTIMG09LimitsWriteWriteAtTruncateAndAllocate(t *testing.T) {
	for name, grow := range map[string]func(f *limitedFile, n int) error{
		"write": func(f *limitedFile, n int) error { _, err := f.Write(make([]byte, n)); return err },
		"writeAt": func(f *limitedFile, n int) error {
			_, err := f.WriteAt(make([]byte, n), 0)
			return err
		},
		"truncate": func(f *limitedFile, n int) error { return f.Truncate(int64(n)) },
		"allocate": func(f *limitedFile, n int) error { return f.Allocate(int64(n)) },
	} {
		t.Run(name, func(t *testing.T) {
			b := newBudget(100)
			handle, err := osFS{}.CreateExclusive(filepath.Join(t.TempDir(), "x"))
			if err != nil {
				t.Fatal(err)
			}
			defer handle.Close()
			b.running = true
			f := newLimitedFile(handle, b)
			if err := grow(f, 100); err != nil {
				t.Fatalf("exact limit refused: %v", err)
			}
			g := newLimitedFile(handle, b)
			if err := grow(g, 101); !errors.Is(err, ErrLimit) || !g.exceeded {
				t.Fatalf("one byte over accepted: %v", err)
			}
		})
	}
}

func TestUTIMG09ReservationsAndCompleteFilesCountTogether(t *testing.T) {
	b := newBudget(100)
	b.put("a.img", 40)
	if b.reserve(61) || !b.reserve(60) {
		t.Fatal("complete files must reduce what can be reserved")
	}
	handle, _ := osFS{}.CreateExclusive(filepath.Join(t.TempDir(), "x"))
	defer handle.Close()
	f := newLimitedFile(handle, b)
	if _, err := f.Write(make([]byte, 60)); err != nil {
		t.Fatal(err)
	}
	if _, err := f.Write([]byte{1}); !errors.Is(err, ErrLimit) {
		t.Fatalf("growth beyond the reservation must still respect the total: %v", err)
	}
	b.finish("", 0)
	if !b.reserve(60) {
		t.Fatal("finish must release the reservation")
	}
}

// IT-IMG-09: complete files, reservations and the false declared size share one limit, with the
// exact boundary accepted and one more byte STORAGE_LIMIT_REACHED.
func TestITIMG09BoundaryAndFalseDeclaredSize(t *testing.T) {
	plain := payload(100) // encrypted maximum: (100/16+1)*16+10 = 122
	encrypted, _ := maxEncryptedSize(100)
	id, ref, _ := reference(t, spec{wid: "edge", plain: plain})
	exact := openService(t, t.TempDir(), encrypted, nil, nil, newNetwork(serving(plain)))
	if _, err := exact.Download(id, ref); err != nil {
		t.Fatalf("exact boundary: %v", err)
	}
	over := openService(t, t.TempDir(), encrypted-1, nil, nil, newNetwork(serving(plain)))
	_, err := over.Download(id, ref)
	wantCode(t, err, StorageLimitReached)
	if over.Stats().UsedBytes != 0 {
		t.Fatal("reservation leaked")
	}
	// A declared length of 1 does not allow real bytes beyond the budget.
	one := "1"
	idF, refF, _ := reference(t, spec{wid: "lie", plain: plain, length: &one})
	dir := t.TempDir()
	liar := openService(t, dir, 80, nil, nil, newNetwork(func(_ context.Context, _ Descriptor, f File) error {
		_, err := f.Write(bytes.Repeat([]byte{9}, 200))
		return err
	}))
	_, err = liar.Download(idF, refF)
	wantCode(t, err, StorageLimitReached)
	if len(files(t, dir)) != 0 {
		t.Fatal("oversized partial kept")
	}
	// Complete files and the new reservation are summed.
	other := payload(60)
	idO, refO, _ := reference(t, spec{wid: "o", plain: other})
	network := newNetwork(serving(other))
	shared := openService(t, t.TempDir(), 59+maxOf(t, 100), nil, nil, network)
	if _, err := shared.Download(idO, refO); err != nil {
		t.Fatal(err)
	}
	network.script = serving(plain)
	_, err = shared.Download(id, ref)
	wantCode(t, err, StorageLimitReached)
	if err := shared.Delete(idO); err != nil {
		t.Fatal(err)
	}
	if _, err := shared.Download(id, ref); err != nil {
		t.Fatalf("freed space not reusable: %v", err)
	}
	// An absurd declared length is refused before any network or allocation.
	huge := "18446744073709551615"
	idH, refH, _ := reference(t, spec{wid: "huge", plain: plain, length: &huge})
	_, err = shared.Download(idH, refH)
	wantCode(t, err, StorageLimitReached)
}

func maxOf(t testing.TB, length uint64) int64 {
	t.Helper()
	size, ok := maxEncryptedSize(length)
	if !ok {
		t.Fatal("size")
	}
	return size
}

func TestStartupCountsExistingFilesAndHonorsReducedLimit(t *testing.T) {
	dir := t.TempDir()
	for name, size := range map[string]int{"a.img": 70, "b.img": 50, "c.part": 30} {
		if err := os.WriteFile(filepath.Join(dir, name), make([]byte, size), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	service := openService(t, dir, 100, nil, nil, nil)
	if got := service.Stats(); got.UsedBytes != 120 || got.Files != 2 {
		t.Fatalf("over-limit data must stay accounted: %+v", got)
	}
	if _, err := os.Stat(filepath.Join(dir, "c.part")); !os.IsNotExist(err) {
		t.Fatal("partial survived startup")
	}
	if !service.SetLimit(500) || service.SetLimit(0) {
		t.Fatal("limit update")
	}
}
