package images

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"io/fs"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"yoyos-whatsapp/internal/normalization"
)

// DownloadTimeout bounds one download after it leaves the queue, shared by internal retries.
const DownloadTimeout = 60 * time.Second

const (
	completeSuffix = ".img"
	partialSuffix  = ".part"
	aesBlock       = 16
	macLength      = 10
)

// File is the writable file a download fills.
type File interface {
	io.Reader
	io.Writer
	io.Seeker
	io.ReaderAt
	io.WriterAt
	Truncate(size int64) error
	Stat() (fs.FileInfo, error)
}

// Lease is one connected generation of the origin account.
type Lease interface {
	// Context ends when the generation is retired.
	Context() context.Context
	Download(ctx context.Context, d Descriptor, file File) error
	// Publish runs publish only when the generation was not retired first; the order between
	// the two is defined, never racing.
	Publish(publish func() error) error
}

// Network hands out generations. Admit records the generation a request was admitted under;
// Acquire returns it at the request's turn, or ErrNotConnected when that generation was
// retired, the account does not match or nothing is connected.
type Network interface {
	Admit() any
	Acquire(admitted any, accountID string) (Lease, error)
}

type Clock interface {
	After(time.Duration) <-chan time.Time
}
type realClock struct{}

func (realClock) After(d time.Duration) <-chan time.Time { return time.After(d) }

// Options configures a Service. Zero Timeout and nil Clock/FS take the production values.
type Options struct {
	Dir        string
	LimitBytes int64
	FS         FS
	Clock      Clock
	Timeout    time.Duration
}

// Image is a published, verified private image.
type Image struct {
	Path     string
	MIMEType string
	Size     int64
}

// Stats reports accounting, including what could not be removed.
type Stats struct {
	UsedBytes       int64
	Files           int // regular files only
	Unreadable      int // foreign entries that could not be read at startup
	CleanupFailures int
	DeleteFailures  int
}

// Service runs downloads and deletions one at a time in admission order.
type Service struct {
	dir     string
	fs      FS
	clock   Clock
	timeout time.Duration
	budget  *budget

	mu              sync.Mutex
	tail            chan struct{}
	network         Network
	cleanupFailures int
	deleteFailures  int
	unreadable      int
}

// Open prepares the directory, accounts every existing file and removes leftover partials. A
// partial that cannot be removed keeps counting against the budget.
func Open(options Options) (*Service, *Error) {
	if options.Dir == "" || options.LimitBytes <= 0 {
		return nil, fail(InvalidInput, nil)
	}
	s := &Service{dir: options.Dir, fs: options.FS, clock: options.Clock, timeout: options.Timeout, budget: newBudget(options.LimitBytes)}
	if s.fs == nil {
		s.fs = osFS{}
	}
	if s.clock == nil {
		s.clock = realClock{}
	}
	if s.timeout <= 0 {
		s.timeout = DownloadTimeout
	}
	if err := s.fs.MkdirAll(s.dir, 0o700); err != nil {
		return nil, fail(DownloadFailed, err)
	}
	entries, err := s.fs.ReadDir(s.dir)
	if err != nil {
		return nil, fail(DownloadFailed, err)
	}
	for _, entry := range entries {
		if entry.IsDir() {
			size, unreadable := s.directorySize(filepath.Join(s.dir, entry.Name()))
			s.unreadable += unreadable
			s.budget.put(entry.Name()+"/", size) // never removed here, but it counts
			continue
		}
		info, err := entry.Info()
		if err != nil {
			s.unreadable++ // a foreign entry that cannot be read must not stop the module
			continue
		}
		name := entry.Name()
		if strings.HasSuffix(name, partialSuffix) {
			if err := s.fs.Remove(filepath.Join(s.dir, name)); err == nil || errors.Is(err, fs.ErrNotExist) {
				continue
			}
			s.cleanupFailures++
		}
		s.budget.put(name, info.Size())
	}
	return s, nil
}

// directorySize adds up the files below a directory so foreign leftovers count against the budget.
// What cannot be read is skipped and reported, never fatal: one foreign entry must not stop the
// module from initializing.
func (s *Service) directorySize(path string) (total int64, unreadable int) {
	entries, err := s.fs.ReadDir(path)
	if err != nil {
		return 0, 1
	}
	for _, entry := range entries {
		if entry.IsDir() {
			size, skipped := s.directorySize(filepath.Join(path, entry.Name()))
			total, unreadable = total+size, unreadable+skipped
			continue
		}
		info, err := entry.Info()
		if err != nil {
			unreadable++
			continue
		}
		total += info.Size()
	}
	return total, unreadable
}

// SetNetwork connects the service to the current connection source; nil disconnects it.
func (s *Service) SetNetwork(network Network) {
	s.mu.Lock()
	s.network = network
	s.mu.Unlock()
}

// SetLimit changes the global budget. Data above a reduced limit stays readable and deletable.
func (s *Service) SetLimit(limit int64) bool {
	if limit <= 0 {
		return false
	}
	s.budget.mu.Lock()
	s.budget.limit = limit
	s.budget.mu.Unlock()
	return true
}

func (s *Service) Stats() Stats {
	s.budget.mu.Lock()
	used, files := s.budget.usedLocked(), 0
	for name := range s.budget.files {
		if !strings.HasSuffix(name, "/") {
			files++
		}
	}
	s.budget.mu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	return Stats{UsedBytes: used, Files: files, CleanupFailures: s.cleanupFailures, DeleteFailures: s.deleteFailures, Unreadable: s.unreadable}
}

type turn struct {
	wait     <-chan struct{}
	done     chan struct{}
	admitted any
}

// admit puts an operation at the end of the queue and records the generation it was admitted
// under; the queue itself is FIFO.
func (s *Service) admit() turn {
	s.mu.Lock()
	defer s.mu.Unlock()
	done := make(chan struct{})
	wait := s.tail
	s.tail = done
	var admitted any
	if s.network != nil {
		admitted = s.network.Admit()
	}
	if wait == nil {
		wait = closedChannel
	}
	return turn{wait: wait, done: done, admitted: admitted}
}

var closedChannel = func() chan struct{} { c := make(chan struct{}); close(c); return c }()

func (s *Service) currentNetwork() Network {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.network
}

// fileName derives the on-disk name from the message identity; no identifier or descriptor is
// ever used as a path.
func fileName(messageID string) string {
	sum := sha256.Sum256([]byte("wa-image-file:v1\x00" + messageID))
	return hex.EncodeToString(sum[:])
}

func (s *Service) path(name string) string { return filepath.Join(s.dir, name) }

// Pending is an operation already admitted to the queue. Admission order is fixed by the order of
// the Begin calls. The operation runs on its own goroutine, started by Begin, as soon as its turn
// comes: progress never depends on anybody calling Wait, nor on the order in which waiters are
// scheduled. Wait only reads the result.
type Pending struct {
	done   chan struct{}
	image  Image
	failed *Error
}

// Wait blocks until the operation finished and returns its result; it may be called any number of
// times, from any goroutine, or never.
func (p *Pending) Wait() (Image, *Error) {
	<-p.done
	return p.image, p.failed
}

func resolved(err *Error) *Pending {
	p := &Pending{done: make(chan struct{}), failed: err}
	close(p.done)
	return p
}

// start runs the operation at its turn on a new goroutine.
func (s *Service) start(t turn, run func() (Image, *Error)) *Pending {
	p := &Pending{done: make(chan struct{})}
	go func() {
		defer close(p.done)
		<-t.wait
		defer close(t.done)
		p.image, p.failed = run()
	}()
	return p
}

// BeginDownload validates the reference and takes a queue position without waiting for it.
func (s *Service) BeginDownload(messageID, downloadReference string) *Pending {
	d, perr := ParseDescriptor(messageID, downloadReference)
	if perr != nil {
		return resolved(perr)
	}
	t := s.admit()
	return s.start(t, func() (Image, *Error) { return s.download(d, t.admitted) })
}

// BeginDelete validates the message ID and takes a queue position without waiting for it.
func (s *Service) BeginDelete(messageID string) *Pending {
	if normalization.ValidateMessageID(messageID) != nil {
		return resolved(fail(InvalidInput, nil))
	}
	t := s.admit()
	return s.start(t, func() (Image, *Error) { return Image{}, s.remove(messageID) })
}

// Download returns the verified image for a descriptor, reusing a valid complete file first.
func (s *Service) Download(messageID, downloadReference string) (Image, *Error) {
	return s.BeginDownload(messageID, downloadReference).Wait()
}

func (s *Service) download(d Descriptor, admitted any) (Image, *Error) {
	base := fileName(d.MessageID)
	final := base + completeSuffix
	image, state, err := s.reuse(d, final)
	switch state {
	case reusable:
		return image, nil
	case unreadable:
		return Image{}, fail(DownloadFailed, err)
	case invalid:
		return Image{}, fail(ImageUnavailable, err)
	}
	if !d.Complete() {
		return Image{}, fail(ImageUnavailable, nil)
	}
	network := s.currentNetwork()
	if network == nil {
		return Image{}, fail(AccountNotConnected, nil)
	}
	lease, err := network.Acquire(admitted, d.AccountID)
	if err != nil {
		return Image{}, fail(AccountNotConnected, err)
	}
	return s.fetch(d, lease, base)
}

type reuseState int

const (
	absent reuseState = iota
	reusable
	invalid
	unreadable
)

// reuse looks for a complete file and verifies it against the descriptor.
func (s *Service) reuse(d Descriptor, final string) (Image, reuseState, error) {
	image, err := s.verify(final, d)
	switch {
	case err == nil:
		return image, reusable, nil
	case errors.Is(err, fs.ErrNotExist):
		s.budget.drop(final)
		return Image{}, absent, nil
	case errors.Is(err, errInvalidFile):
		return Image{}, invalid, err
	}
	return Image{}, unreadable, err
}

var errInvalidFile = errors.New("complete file does not match its descriptor")

// verify streams the file once: integrity against the descriptor's hash and a MIME from its bytes.
func (s *Service) verify(name string, d Descriptor) (Image, error) {
	file, err := s.fs.Open(s.path(name))
	if err != nil {
		return Image{}, err
	}
	defer file.Close()
	hasher := sha256.New()
	head := make([]byte, 32)
	filled, err := io.ReadFull(file, head)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) && !errors.Is(err, io.EOF) {
		return Image{}, err
	}
	hasher.Write(head[:filled])
	rest, err := io.Copy(hasher, file)
	if err != nil {
		return Image{}, err
	}
	size := int64(filled) + rest
	mime := sniffMIME(head[:filled])
	if size == 0 || mime == "" || len(d.FileSHA256) != 32 || !hmac.Equal(hasher.Sum(nil), d.FileSHA256) {
		return Image{}, errInvalidFile
	}
	return Image{Path: s.path(name), MIMEType: mime, Size: size}, nil
}

// maxEncryptedSize is the largest encrypted temporary file for a declared length: padded
// ciphertext plus the trailing MAC. It reports false when the declaration cannot fit an int64.
func maxEncryptedSize(length uint64) (int64, bool) {
	if length > 1<<60 {
		return 0, false
	}
	return int64((length/aesBlock+1)*aesBlock + macLength), true
}

func (s *Service) fetch(d Descriptor, lease Lease, base string) (Image, *Error) {
	forecast := s.budget.available()
	if d.HasLength {
		encrypted, ok := maxEncryptedSize(d.FileLength)
		if !ok || encrypted > forecast {
			return Image{}, fail(StorageLimitReached, nil)
		}
		forecast = encrypted
	}
	nonce := make([]byte, 8)
	if _, err := rand.Read(nonce); err != nil {
		return Image{}, fail(DownloadFailed, err)
	}
	part, final := base+"."+hex.EncodeToString(nonce)+partialSuffix, base+completeSuffix
	if !s.budget.reserve(forecast) {
		return Image{}, fail(StorageLimitReached, nil)
	}
	handle, err := s.fs.CreateExclusive(s.path(part))
	if err != nil {
		s.budget.finish("", 0)
		return Image{}, fail(DownloadFailed, err)
	}
	file := newLimitedFile(handle, s.budget)
	ctx, stop := s.withDeadline(lease.Context())
	err = lease.Download(ctx, d, file)
	cause := context.Cause(ctx)
	stop()
	if err == nil && cause != nil {
		err = cause
	}
	if err != nil {
		return Image{}, s.abandon(handle, file, part, classify(err, cause, file))
	}
	image, perr := s.publish(handle, file, lease, d, part, final)
	if perr != nil {
		return Image{}, perr
	}
	return image, nil
}

// publish closes, verifies and renames the finished temporary file; each failure removes it.
func (s *Service) publish(handle Handle, file *limitedFile, lease Lease, d Descriptor, part, final string) (Image, *Error) {
	if err := handle.Sync(); err != nil {
		return Image{}, s.abandon(handle, file, part, fail(DownloadFailed, err))
	}
	if err := handle.Close(); err != nil {
		return Image{}, s.abandon(nil, file, part, fail(DownloadFailed, err))
	}
	image, err := s.verify(part, d)
	if err != nil {
		code := ImageUnavailable
		if !errors.Is(err, errInvalidFile) {
			code = DownloadFailed
		}
		return Image{}, s.abandon(nil, file, part, fail(code, err))
	}
	if err := lease.Publish(func() error { return s.fs.Rename(s.path(part), s.path(final)) }); err != nil {
		return Image{}, s.abandon(nil, file, part, fail(DownloadFailed, err))
	}
	s.budget.finish("", 0)
	s.budget.put(final, image.Size)
	image.Path = s.path(final)
	return image, nil
}

// abandon closes and removes the partial. When removal fails it keeps counting its real size.
func (s *Service) abandon(handle Handle, file *limitedFile, part string, failure *Error) *Error {
	size := file.size
	if handle != nil {
		if info, err := handle.Stat(); err == nil {
			size = info.Size()
		}
		_ = handle.Close()
	}
	err := s.fs.Remove(s.path(part))
	if err == nil || errors.Is(err, fs.ErrNotExist) {
		s.budget.finish("", 0)
		return failure
	}
	s.mu.Lock()
	s.cleanupFailures++
	s.mu.Unlock()
	s.budget.finish(part, size)
	return &Error{Code: failure.Code, Cause: errors.Join(failure.Cause, err)}
}

func classify(err, cause error, file *limitedFile) *Error {
	switch {
	case file.exceeded || errors.Is(err, ErrLimit):
		return fail(StorageLimitReached, err)
	case errors.Is(err, ErrGone), errors.Is(err, ErrCorrupt):
		return fail(ImageUnavailable, err)
	}
	return fail(DownloadFailed, err)
}

// withDeadline bounds ctx by the operation timeout on the service clock.
func (s *Service) withDeadline(parent context.Context) (context.Context, func()) {
	ctx, cancel := context.WithCancelCause(parent)
	timer := s.clock.After(s.timeout)
	stop := make(chan struct{})
	go func() {
		select {
		case <-timer:
			cancel(errTimeout)
		case <-stop:
		case <-ctx.Done():
		}
	}()
	return ctx, func() { close(stop); cancel(nil) }
}

// Delete removes the complete file and any partial left for the message. An absent file is
// success; any other failure is IMAGE_DELETE_FAILED and the bytes keep counting.
func (s *Service) Delete(messageID string) *Error {
	_, err := s.BeginDelete(messageID).Wait()
	return err
}

func (s *Service) remove(messageID string) *Error {
	base := fileName(messageID)
	var failures []error
	names := append([]string{base + completeSuffix}, s.budget.partialsOf(base)...)
	for _, name := range names {
		err := s.fs.Remove(s.path(name))
		if err == nil || errors.Is(err, fs.ErrNotExist) {
			s.budget.drop(name)
			continue
		}
		failures = append(failures, err)
	}
	if len(failures) == 0 {
		return nil
	}
	s.mu.Lock()
	s.deleteFailures++
	s.mu.Unlock()
	return fail(DeleteFailed, errors.Join(failures...))
}
