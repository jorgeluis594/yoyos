package images

import (
	"errors"
	"fmt"
	"io"
	"os"
)

// limitedFile bounds the real size of a temporary file on every operation that can grow it:
// Write, WriteAt, Truncate and Allocate. The declared length never widens the bound.
type limitedFile struct {
	handle   Handle
	budget   *budget
	size     int64
	offset   int64
	exceeded bool
}

func newLimitedFile(handle Handle, b *budget) *limitedFile {
	return &limitedFile{handle: handle, budget: b}
}

func (f *limitedFile) grow(newSize int64) error {
	if newSize <= f.size {
		return nil
	}
	if !f.budget.fits(newSize) {
		f.exceeded = true
		return fmt.Errorf("%w: %d bytes", ErrLimit, newSize)
	}
	return nil
}

func (f *limitedFile) record(size int64) {
	f.size = size
	f.budget.setActive(size)
}

func (f *limitedFile) Write(p []byte) (int, error) {
	if err := f.grow(f.offset + int64(len(p))); err != nil {
		return 0, err
	}
	n, err := f.handle.Write(p)
	f.offset += int64(n)
	if f.offset > f.size {
		f.record(f.offset)
	}
	return n, err
}

func (f *limitedFile) WriteAt(p []byte, off int64) (int, error) {
	if off < 0 {
		return 0, errors.New("negative offset")
	}
	if err := f.grow(off + int64(len(p))); err != nil {
		return 0, err
	}
	n, err := f.handle.WriteAt(p, off)
	if end := off + int64(n); end > f.size {
		f.record(end)
	}
	return n, err
}

func (f *limitedFile) Truncate(size int64) error {
	if size < 0 {
		return errors.New("negative size")
	}
	if err := f.grow(size); err != nil {
		return err
	}
	if err := f.handle.Truncate(size); err != nil {
		return err
	}
	f.record(size)
	return nil
}

// Allocate is the preallocation entry point: it is checked against the budget and allocates
// nothing, so a false Content-Length cannot reserve more than the budget allows.
func (f *limitedFile) Allocate(size int64) error { return f.grow(size) }

func (f *limitedFile) Seek(offset int64, whence int) (int64, error) {
	position, err := f.handle.Seek(offset, whence)
	if err == nil {
		f.offset = position
	}
	return position, err
}

func (f *limitedFile) Read(p []byte) (int, error) {
	n, err := f.handle.Read(p)
	f.offset += int64(n)
	return n, err
}

func (f *limitedFile) ReadAt(p []byte, off int64) (int, error) { return f.handle.ReadAt(p, off) }
func (f *limitedFile) Stat() (os.FileInfo, error)              { return f.handle.Stat() }

var _ io.WriterAt = (*limitedFile)(nil)
