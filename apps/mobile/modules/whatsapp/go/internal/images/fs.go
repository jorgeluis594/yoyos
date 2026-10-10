package images

import (
	"io"
	"io/fs"
	"os"
)

// Handle is the writable temporary file. It matches the file the pinned whatsmeow downloader
// expects, plus the durability calls the service needs.
type Handle interface {
	io.Reader
	io.Writer
	io.Seeker
	io.ReaderAt
	io.WriterAt
	Truncate(size int64) error
	Stat() (os.FileInfo, error)
	Sync() error
	Close() error
}

// FS is the filesystem the service uses; tests replace it to inject failures.
type FS interface {
	MkdirAll(path string, perm fs.FileMode) error
	ReadDir(path string) ([]fs.DirEntry, error)
	CreateExclusive(path string) (Handle, error)
	Open(path string) (io.ReadCloser, error)
	Rename(oldPath, newPath string) error
	Remove(path string) error
}

type osFS struct{}

func (osFS) MkdirAll(path string, perm fs.FileMode) error { return os.MkdirAll(path, perm) }
func (osFS) ReadDir(path string) ([]fs.DirEntry, error)   { return os.ReadDir(path) }
func (osFS) CreateExclusive(path string) (Handle, error) {
	return os.OpenFile(path, os.O_RDWR|os.O_CREATE|os.O_EXCL, 0o600)
}
func (osFS) Open(path string) (io.ReadCloser, error) { return os.Open(path) }
func (osFS) Rename(oldPath, newPath string) error    { return os.Rename(oldPath, newPath) }
func (osFS) Remove(path string) error                { return os.Remove(path) }
