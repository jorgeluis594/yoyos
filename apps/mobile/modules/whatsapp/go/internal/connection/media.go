package connection

import (
	"context"
	"errors"
	"io"
	"io/fs"

	"go.mau.fi/whatsmeow"
)

// MediaRequest is what the pinned client needs to fetch and decrypt one image. The hosts come
// from the client's own media connection; nothing here names one.
type MediaRequest struct {
	DirectPath    string
	MediaKey      []byte
	FileSHA256    []byte
	FileEncSHA256 []byte
}

// MediaFile is the file a download fills.
type MediaFile interface {
	io.Reader
	io.Writer
	io.Seeker
	io.ReaderAt
	io.WriterAt
	Truncate(size int64) error
	Stat() (fs.FileInfo, error)
}

// MediaTransport is implemented by transports that can download media over their connection.
type MediaTransport interface {
	DownloadMedia(ctx context.Context, request MediaRequest, file MediaFile) error
}

// ErrMediaUnavailable means no live generation can download.
var ErrMediaUnavailable = errors.New("no connected generation")

// ErrMediaRetired means the generation ended before the operation completed.
var ErrMediaRetired = errors.New("generation retired")

// MediaAdmission is the generation observed when a download was admitted.
type MediaAdmission struct {
	Generation uint64
	Connected  bool
}

// AdmitMedia records the current generation without holding anything.
func (c *Controller) AdmitMedia() MediaAdmission {
	c.mu.Lock()
	defer c.mu.Unlock()
	return MediaAdmission{Generation: c.generation, Connected: c.mediaReadyLocked() != nil}
}

func (c *Controller) mediaReadyLocked() MediaTransport {
	if c.state != Connected || !c.requested || c.paused || c.logout != nil || c.runCtx == nil {
		return nil
	}
	transport, _ := c.transport.(MediaTransport)
	return transport
}

// AcquireMedia returns a lease on the connected generation. A request admitted while a
// generation was connected only gets that same generation; one admitted while disconnected may
// use whichever is connected at its turn.
func (c *Controller) AcquireMedia(admitted MediaAdmission) (*MediaLease, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	transport := c.mediaReadyLocked()
	if transport == nil {
		return nil, ErrMediaUnavailable
	}
	if admitted.Connected && admitted.Generation != c.generation {
		return nil, ErrMediaUnavailable
	}
	return &MediaLease{controller: c, generation: c.generation, ctx: c.runCtx, transport: transport}, nil
}

// MediaLease is one connected generation. Its context ends when the generation is retired.
type MediaLease struct {
	controller *Controller
	generation uint64
	ctx        context.Context
	transport  MediaTransport
}

func (l *MediaLease) Context() context.Context { return l.ctx }

func (l *MediaLease) Download(ctx context.Context, request MediaRequest, file MediaFile) error {
	return l.transport.DownloadMedia(ctx, request, file)
}

// Publish runs publish under the controller lock, so it is totally ordered against every
// retirement: either the generation was current for the whole call, or publish never runs.
func (l *MediaLease) Publish(publish func() error) error {
	c := l.controller
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.generation != l.generation || !c.requested {
		return ErrMediaRetired
	}
	return publish()
}

// DownloadMedia downloads and decrypts an image with the pinned client, which owns the media
// hosts, the retries across them and the integrity checks.
func (t *whatsmeowTransport) DownloadMedia(ctx context.Context, request MediaRequest, file MediaFile) error {
	return t.client.DownloadMediaWithPathToFile(ctx, request.DirectPath, request.FileEncSHA256, request.FileSHA256, request.MediaKey, whatsmeow.MediaImage, "", false, file)
}
