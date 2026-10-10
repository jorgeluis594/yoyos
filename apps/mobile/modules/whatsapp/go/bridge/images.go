package bridge

import (
	"context"
	"errors"
	"sync"

	"go.mau.fi/whatsmeow"
	"yoyos-whatsapp/internal/connection"
	"yoyos-whatsapp/internal/images"
)

// ImageSession owns the private image directory and its byte budget. It is independent of the
// connection and of the delivery coordinator: no lock is shared with confirmations or with the
// session writer, and a logout never touches the files.
type ImageSession struct {
	service *images.Service
	mu      sync.Mutex
	current *ConnectionSession
}

type ImageOpenResult struct {
	Session *ImageSession
	Code    string
}

// OpenImages prepares the directory: it accounts existing files and removes leftover partials.
func OpenImages(directory string, maxImageStorageBytes int64) *ImageOpenResult {
	service, err := images.Open(images.Options{Dir: directory, LimitBytes: maxImageStorageBytes})
	if err != nil {
		return &ImageOpenResult{Code: imageCode(err.Code, "NATIVE_CALL_FAILED")}
	}
	return &ImageOpenResult{Session: &ImageSession{service: service}}
}

// ImageDownloadResult keeps errors explicit across bindings that advertise nonnull returns.
// Path is the published private file; the platform turns it into a URI.
type ImageDownloadResult struct {
	Path     string
	MimeType string
	Size     int64
	Code     string
}

// ImageOperation is an image call already admitted to the ordered queue. Native calls Begin* from
// one serial context, so admission follows call order, and Wait from anywhere: the long wait for
// the turn and the transfer happens outside the admitting context.
type ImageOperation struct {
	pending *images.Pending
	code    string
}

// BeginDownload takes the queue position of a download without waiting for its turn.
func (s *ImageSession) BeginDownload(messageID, downloadReference string) *ImageOperation {
	if s == nil || s.service == nil {
		return &ImageOperation{code: "NOT_INITIALIZED"}
	}
	return &ImageOperation{pending: s.service.BeginDownload(messageID, downloadReference)}
}

// BeginDelete takes the queue position of a deletion without waiting for its turn.
func (s *ImageSession) BeginDelete(messageID string) *ImageOperation {
	if s == nil || s.service == nil {
		return &ImageOperation{code: "NOT_INITIALIZED"}
	}
	return &ImageOperation{pending: s.service.BeginDelete(messageID)}
}

// Wait runs the operation in its position. A deletion answers with Code only.
func (o *ImageOperation) Wait() *ImageDownloadResult {
	if o == nil || o.pending == nil {
		code := "NOT_INITIALIZED"
		if o != nil && o.code != "" {
			code = o.code
		}
		return &ImageDownloadResult{Code: code}
	}
	image, err := o.pending.Wait()
	if err != nil {
		return &ImageDownloadResult{Code: imageCode(err.Code, "NATIVE_CALL_FAILED")}
	}
	return &ImageDownloadResult{Path: image.Path, MimeType: image.MIMEType, Size: image.Size}
}

// Download returns a verified image, reusing a complete file before any network.
func (s *ImageSession) Download(messageID, downloadReference string) *ImageDownloadResult {
	if s == nil || s.service == nil {
		return &ImageDownloadResult{Code: "NOT_INITIALIZED"}
	}
	return s.BeginDownload(messageID, downloadReference).Wait()
}

// Delete removes the complete file; an absent file is success. It returns a public code or "".
func (s *ImageSession) Delete(messageID string) string {
	if s == nil || s.service == nil {
		return "NOT_INITIALIZED"
	}
	if err := s.service.Delete(messageID); err != nil {
		return imageCode(err.Code, "NATIVE_CALL_FAILED")
	}
	return ""
}

// SetLimit changes the global budget; data above a lowered limit stays readable and deletable.
func (s *ImageSession) SetLimit(maxImageStorageBytes int64) bool {
	return s != nil && s.service != nil && s.service.SetLimit(maxImageStorageBytes)
}

func imageCode(code images.Code, fallback string) string {
	if code == "" {
		return fallback
	}
	return string(code)
}

// AttachImages lets the connection serve the downloads of the image session.
func (s *ConnectionSession) AttachImages(i *ImageSession) {
	if s == nil || i == nil {
		return
	}
	s.mu.Lock()
	s.images = i
	s.mu.Unlock()
	i.mu.Lock()
	i.current = s
	i.mu.Unlock()
	i.service.SetNetwork(connectionNetwork{session: s})
}

func (s *ConnectionSession) detachImages() {
	s.mu.Lock()
	attached := s.images
	s.images = nil
	s.mu.Unlock()
	if attached == nil {
		return
	}
	attached.mu.Lock()
	owns := attached.current == s
	if owns {
		attached.current = nil
	}
	attached.mu.Unlock()
	if owns {
		attached.service.SetNetwork(nil)
	}
}

// account is the canonical LID of the linked account, empty before pairing completes.
func (s *ConnectionSession) account() string {
	s.mu.Lock()
	device := s.device
	s.mu.Unlock()
	if device == nil || device.LID.IsEmpty() {
		return ""
	}
	return device.LID.ToNonAD().String()
}

// connectionNetwork adapts the controller's generation to the image service.
type connectionNetwork struct{ session *ConnectionSession }

func (n connectionNetwork) Admit() any { return n.session.controller.AdmitMedia() }

func (n connectionNetwork) Acquire(admitted any, accountID string) (images.Lease, error) {
	if account := n.session.account(); account == "" || account != accountID {
		return nil, images.ErrNotConnected
	}
	admission, _ := admitted.(connection.MediaAdmission)
	lease, err := n.session.controller.AcquireMedia(admission)
	if err != nil {
		return nil, images.ErrNotConnected
	}
	return mediaLease{lease}, nil
}

type mediaLease struct{ lease *connection.MediaLease }

func (l mediaLease) Context() context.Context { return l.lease.Context() }

func (l mediaLease) Download(ctx context.Context, d images.Descriptor, file images.File) error {
	err := l.lease.Download(ctx, connection.MediaRequest{DirectPath: d.DirectPath, MediaKey: d.MediaKey, FileSHA256: d.FileSHA256, FileEncSHA256: d.FileEncSHA256}, file)
	return classifyDownload(err)
}

func (l mediaLease) Publish(publish func() error) error {
	err := l.lease.Publish(publish)
	if errors.Is(err, connection.ErrMediaRetired) {
		return images.ErrRetired
	}
	return err
}

// classifyDownload separates "the resource is gone" and "the content is corrupt" from transient
// failures; the pinned client reports both with its own sentinels. A bad HMAC or a too-short file
// is deliberately not "corrupt": after a failed host the pinned client appends the next host's
// body to the previous partial data without rewinding, so those errors can follow a transient
// failure and must stay retryable (IMAGE_DOWNLOAD_FAILED) instead of becoming permanent.
func classifyDownload(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, whatsmeow.ErrMediaDownloadFailedWith403), errors.Is(err, whatsmeow.ErrMediaDownloadFailedWith404),
		errors.Is(err, whatsmeow.ErrMediaDownloadFailedWith410), errors.Is(err, whatsmeow.ErrNoURLPresent):
		return errors.Join(images.ErrGone, err)
	case errors.Is(err, whatsmeow.ErrInvalidMediaSHA256), errors.Is(err, whatsmeow.ErrInvalidMediaEncSHA256):
		return errors.Join(images.ErrCorrupt, err)
	}
	return err
}
