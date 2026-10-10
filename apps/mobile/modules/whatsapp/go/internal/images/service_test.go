package images

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func wantCode(t testing.TB, err *Error, code Code) {
	t.Helper()
	if err == nil || err.Code != code {
		t.Fatalf("got %v, want %s", err, code)
	}
}

// UT-IMG-02 / IT-IMG-02: malformed or incoherent descriptors are INVALID_INPUT.
func TestUTIMG02RejectsMalformedAndIncoherentDescriptors(t *testing.T) {
	id, ref, _ := reference(t, spec{wid: "a", plain: payload(40)})
	other := messageID(t, "b")
	good := strings.TrimPrefix(ref, "wa-image:v1:")
	raw, _ := base64.RawURLEncoding.DecodeString(good)
	extra := "wa-image:v1:" + base64.RawURLEncoding.EncodeToString(append(raw[:len(raw)-1], []byte(`,"url":"https://x"}`)...))
	badKey := encode(t, map[string]string{"accountId": testAccount, "messageId": id, "mediaKey": base64.StdEncoding.EncodeToString([]byte("short"))})
	badLength := encode(t, map[string]string{"accountId": testAccount, "messageId": id, "fileLength": "012"})
	hugeLength := encode(t, map[string]string{"accountId": testAccount, "messageId": id, "fileLength": "18446744073709551616"})
	foreignAccount := encode(t, map[string]string{"accountId": "999@lid", "messageId": id})
	for name, c := range map[string]struct{ id, ref string }{
		"prefix":   {id, "wa-image:v2:" + good},
		"unknown":  {id, "image:" + good},
		"field":    {id, extra},
		"base64":   {id, "wa-image:v1:***"},
		"oversize": {id, "wa-image:v1:" + strings.Repeat("A", 16*1024)},
		"mismatch": {other, ref},
		"key":      {id, badKey},
		"length":   {id, badLength},
		"huge":     {id, hugeLength},
		"account":  {id, foreignAccount},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := ParseDescriptor(c.id, c.ref)
			wantCode(t, err, InvalidInput)
		})
	}
	d, err := ParseDescriptor(id, encode(t, map[string]string{"accountId": testAccount, "messageId": id, "fileLength": "18446744073709551615"}))
	if err != nil || !d.HasLength || d.FileLength != 18446744073709551615 {
		t.Fatalf("uint64 lost precision: %+v %v", d, err)
	}
}

// UT-IMG-03 / IT-IMG-03: only media paths of the client are accepted.
func TestUTIMG03RejectsArbitraryPathsAndHosts(t *testing.T) {
	id := messageID(t, "a")
	for _, path := range []string{"https://evil.example/v/x", "//evil.example/v/x", "v/t62/x", "/v/x#frag", "/v/x?a=1#frag", "file:///etc/passwd", "/../../etc/passwd://x", "/v/../x", "/v/./x", "/v\\x", "/v/x\n", "/v/x y", "/v/x?a=1#f"} {
		ref := encode(t, map[string]string{"accountId": testAccount, "messageId": id, "directPath": path})
		_, err := ParseDescriptor(id, ref)
		if path == "/../../etc/passwd://x" || err != nil {
			wantCode(t, err, InvalidInput)
			continue
		}
		t.Fatalf("%q was accepted", path)
	}
	// M2: the form the pinned client expects carries its query; "&hash=" is appended to it.
	query := "/v/t62.7118-24/123_n.enc?ccb=11-4&oh=01_x&oe=6612A1B2&_nc_sid=5e03e0"
	_, withQuery, _ := reference(t, spec{wid: "q", plain: payload(30), directPath: query})
	if d, err := ParseDescriptor(messageID(t, "q"), withQuery); err != nil || d.DirectPath != query {
		t.Fatalf("real path form rejected: %v", err)
	}
	_, ref, _ := reference(t, spec{wid: "ok", plain: payload(30)})
	_, err := ParseDescriptor(messageID(t, "ok"), ref)
	if err != nil {
		t.Fatal(err)
	}
	// The download receives the descriptor's path only; no host or filesystem input exists.
	var seen Descriptor
	network := newNetwork(func(_ context.Context, d Descriptor, f File) error { seen = d; return simulate(f, payload(30)) })
	service := openService(t, t.TempDir(), 1<<20, nil, nil, network)
	if _, err := service.Download(messageID(t, "ok"), ref); err != nil {
		t.Fatal(err)
	}
	if seen.DirectPath != "/v/t62/abc" {
		t.Fatalf("path %q", seen.DirectPath)
	}
}

// UT-IMG-04 / IT-IMG-04: incomplete metadata and expired resources are IMAGE_UNAVAILABLE.
func TestUTIMG04UnavailableForIncompleteOrExpired(t *testing.T) {
	network := newNetwork(func(context.Context, Descriptor, File) error { return ErrGone })
	service := openService(t, t.TempDir(), 1<<20, nil, nil, network)
	id := messageID(t, "inc")
	incomplete := encode(t, map[string]string{"accountId": testAccount, "messageId": id, "mimeType": "image/jpeg"})
	_, err := service.Download(id, incomplete)
	wantCode(t, err, ImageUnavailable)
	idB, refB, _ := reference(t, spec{wid: "gone", plain: payload(50)})
	_, err = service.Download(idB, refB)
	wantCode(t, err, ImageUnavailable)
	if network.networkCalls() != 1 {
		t.Fatalf("incomplete metadata reached the network or the expired one was retried: %d", network.networkCalls())
	}
	network.script = func(context.Context, Descriptor, File) error { return ErrCorrupt }
	_, err = service.Download(idB, refB)
	wantCode(t, err, ImageUnavailable)
}

// UT-IMG-05 / IT-IMG-05: a new download needs the origin account connected, with no auto-connect.
func TestUTIMG05RequiresOriginAccountConnected(t *testing.T) {
	id, ref, _ := reference(t, spec{wid: "a", plain: payload(40)})
	network := newNetwork(serving(payload(40)))
	network.account = "999@lid"
	service := openService(t, t.TempDir(), 1<<20, nil, nil, network)
	_, err := service.Download(id, ref)
	wantCode(t, err, AccountNotConnected)
	network.account = testAccount
	network.disconnect()
	_, err = service.Download(id, ref)
	wantCode(t, err, AccountNotConnected)
	service.SetNetwork(nil)
	_, err = service.Download(id, ref)
	wantCode(t, err, AccountNotConnected)
	if network.networkCalls() != 0 {
		t.Fatal("network was used without the origin account")
	}
	network.connect()
	service.SetNetwork(network)
	if _, err := service.Download(id, ref); err != nil {
		t.Fatal(err)
	}
}

// IT-IMG-01 / IT-IMG-06: a reference kept across a restart downloads, verifies and publishes
// before the path is returned; no bytes cross the API and the file stays private.
func TestITIMG01DownloadsAReferenceKeptAcrossRestart(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "images")
	plain := payload(5000)
	id, ref, _ := reference(t, spec{wid: "restart", plain: plain})
	first := openService(t, dir, 1<<20, nil, nil, nil)
	_, err := first.Download(id, ref)
	wantCode(t, err, AccountNotConnected)
	second := openService(t, dir, 1<<20, nil, nil, newNetwork(serving(plain)))
	image, err := second.Download(id, ref)
	if err != nil {
		t.Fatal(err)
	}
	if image.MIMEType != "image/jpeg" || image.Size != 5000 || filepath.Dir(image.Path) != dir {
		t.Fatalf("unexpected image %+v", image)
	}
	got, readErr := os.ReadFile(image.Path)
	info, _ := os.Stat(image.Path)
	if readErr != nil || !bytes.Equal(got, plain) || info.Mode().Perm() != 0o600 {
		t.Fatalf("published file not private/complete: %v %v", readErr, info.Mode())
	}
	for _, name := range files(t, dir) {
		if strings.HasSuffix(name, partialSuffix) {
			t.Fatalf("temporary file left behind: %s", name)
		}
	}
}

// IT-IMG-07: bad integrity or an indeterminable MIME is never a success.
func TestITIMG07RejectsInvalidIntegrityOrMIME(t *testing.T) {
	plain := payload(300)
	id, ref, _ := reference(t, spec{wid: "bad", plain: plain})
	tampered := append([]byte{}, plain...)
	tampered[200] ^= 1
	dir := t.TempDir()
	network := newNetwork(serving(tampered))
	service := openService(t, dir, 1<<20, nil, nil, network)
	_, err := service.Download(id, ref)
	wantCode(t, err, ImageUnavailable)
	if len(files(t, dir)) != 0 || service.Stats().UsedBytes != 0 {
		t.Fatal("rejected download left bytes behind")
	}
	text := bytes.Repeat([]byte("plain text "), 20)
	idT, refT, _ := reference(t, spec{wid: "text", plain: text})
	network.script = serving(text)
	_, err = service.Download(idT, refT)
	wantCode(t, err, ImageUnavailable)
	// An invalid complete file is not a success and can be deleted explicitly before retrying.
	name := fileName(id) + completeSuffix
	if writeErr := os.WriteFile(filepath.Join(dir, name), tampered, 0o600); writeErr != nil {
		t.Fatal(writeErr)
	}
	service = openService(t, dir, 1<<20, nil, nil, network)
	_, err = service.Download(id, ref)
	wantCode(t, err, ImageUnavailable)
	if service.Delete(id) != nil {
		t.Fatal("explicit delete failed")
	}
	network.script = serving(plain)
	if _, err := service.Download(id, ref); err != nil {
		t.Fatalf("retry after delete: %v", err)
	}
}

// IT-IMG-08: a valid complete file is reused with no session, after logout, with another
// account active, and its descriptor is still validated.
func TestITIMG08ReusesCompleteFileWithoutConnection(t *testing.T) {
	plain := payload(900)
	id, ref, _ := reference(t, spec{wid: "reuse", plain: plain})
	dir := t.TempDir()
	network := newNetwork(serving(plain))
	service := openService(t, dir, 1<<20, nil, nil, network)
	first, err := service.Download(id, ref)
	if err != nil {
		t.Fatal(err)
	}
	network.disconnect()
	network.account = "999@lid"
	network.connect()
	again, err := service.Download(id, ref)
	if err != nil || again != first || network.networkCalls() != 1 {
		t.Fatalf("not reused: %+v %v calls=%d", again, err, network.networkCalls())
	}
	service.SetNetwork(nil)
	if _, err := service.Download(id, ref); err != nil {
		t.Fatal(err)
	}
	_, err = service.Download(id, "wa-image:v1:AAAA")
	wantCode(t, err, InvalidInput)
}

// IT-IMG-10 / UT-IMG-10: 60 s per operation on the service clock, queue wait excluded, no
// automatic second attempt by the wrapper.
func TestUTIMG10TimeoutExcludesQueueAndDoesNotRetry(t *testing.T) {
	clock := newClock()
	plain := payload(100)
	idA, refA, _ := reference(t, spec{wid: "slow", plain: plain})
	idB, refB, _ := reference(t, spec{wid: "fast", plain: plain})
	started := make(chan struct{})
	var network *fakeNetwork
	network = newNetwork(func(ctx context.Context, d Descriptor, f File) error {
		if d.MessageID == idA {
			close(started)
			<-ctx.Done()
			return context.Cause(ctx)
		}
		return simulate(f, plain)
	})
	service := openService(t, t.TempDir(), 1<<20, nil, clock, network)
	var wg sync.WaitGroup
	var errA, errB *Error
	wg.Add(1)
	go func() { defer wg.Done(); _, errA = service.Download(idA, refA) }()
	<-started
	clock.waitTimer(t)
	if clock.asked[0] != 60*time.Second {
		t.Fatalf("deadline %v", clock.asked[0])
	}
	wg.Add(1)
	go func() { defer wg.Done(); _, errB = service.Download(idB, refB) }()
	time.Sleep(20 * time.Millisecond) // B is queued behind A and its clock has not started
	if len(clock.asked) != 1 {
		t.Fatal("queue wait was timed")
	}
	clock.fireAll()
	wg.Wait()
	wantCode(t, errA, DownloadFailed)
	if errB != nil {
		t.Fatalf("queued request inherited the timeout: %v", errB)
	}
	if network.networkCalls() != 2 {
		t.Fatalf("wrapper retried by itself: %d calls", network.networkCalls())
	}
}

// IT-IMG-11: failed downloads remove the partial; a failed removal keeps counting its bytes and
// is reported; restart repeats the cleanup and keeps complete files.
func TestITIMG11CleansPartialsAndKeepsConsumptionOnFailure(t *testing.T) {
	dir := t.TempDir()
	filesystem := &faultyFS{}
	boom := errors.New("boom")
	network := newNetwork(func(_ context.Context, _ Descriptor, f File) error {
		_, _ = f.Write(bytes.Repeat([]byte{1}, 700))
		return boom
	})
	service := openService(t, dir, 1<<20, filesystem, nil, network)
	id, ref, _ := reference(t, spec{wid: "p", plain: payload(100)})
	_, err := service.Download(id, ref)
	wantCode(t, err, DownloadFailed)
	if len(files(t, dir)) != 0 || service.Stats().UsedBytes != 0 {
		t.Fatal("partial not removed")
	}
	filesystem.setRemove(func(path string) error {
		if _, err := os.Stat(path); err == nil && strings.HasSuffix(path, partialSuffix) {
			return permission(path)
		}
		return nil
	})
	_, err = service.Download(id, ref)
	wantCode(t, err, DownloadFailed)
	if !errors.Is(err, fsPermission) {
		t.Fatalf("cleanup failure not reported: %v", err)
	}
	stats := service.Stats()
	if stats.UsedBytes != 700 || stats.CleanupFailures != 1 {
		t.Fatalf("consumption not kept: %+v", stats)
	}
	// A complete file stored earlier survives the restart cleanup.
	completeID, completeRef, _ := reference(t, spec{wid: "keep", plain: payload(64)})
	network.script = serving(payload(64))
	filesystem.setRemove(nil)
	if _, err := service.Download(completeID, completeRef); err != nil {
		t.Fatal(err)
	}
	filesystem.setRemove(func(path string) error {
		if _, err := os.Stat(path); err == nil && strings.HasSuffix(path, partialSuffix) {
			return permission(path)
		}
		return nil
	})
	reopened := openService(t, dir, 1<<20, filesystem, nil, network)
	if got := reopened.Stats(); got.UsedBytes != 700+64 || got.CleanupFailures != 1 {
		t.Fatalf("reopen: %+v", got)
	}
	filesystem.setRemove(nil)
	reopened = openService(t, dir, 1<<20, filesystem, nil, network)
	if got := reopened.Stats(); got.UsedBytes != 64 || got.Files != 1 {
		t.Fatalf("reopen did not clean: %+v", got)
	}
}

var fsPermission = os.ErrPermission

// UT-IMG-12 / IT-IMG-12: deletion is idempotent and does not confuse errors with absence.
func TestUTIMG12DeleteIsIdempotentAndDistinguishesErrors(t *testing.T) {
	dir := t.TempDir()
	filesystem := &faultyFS{}
	plain := payload(256)
	id, ref, _ := reference(t, spec{wid: "d", plain: plain})
	service := openService(t, dir, 1<<20, filesystem, nil, newNetwork(serving(plain)))
	if err := service.Delete(id); err != nil {
		t.Fatalf("absent file: %v", err)
	}
	if _, err := service.Download(id, ref); err != nil {
		t.Fatal(err)
	}
	filesystem.setRemove(func(path string) error { return permission(path) })
	err := service.Delete(id)
	wantCode(t, err, DeleteFailed)
	if got := service.Stats(); got.UsedBytes != 256 || got.DeleteFailures != 1 {
		t.Fatalf("space claimed freed: %+v", got)
	}
	filesystem.setRemove(nil)
	if service.Delete(id) != nil || service.Delete(id) != nil || service.Stats().UsedBytes != 0 {
		t.Fatal("delete not idempotent")
	}
	wantCode(t, service.Delete("wa-message:v1:../../x"), InvalidInput)
}

// UT-IMG-13 / IT-IMG-13: serial operations; the second request of one attachment reuses the first success.
func TestUTIMG13SerializesAndDeduplicates(t *testing.T) {
	plain := payload(500)
	id, ref, _ := reference(t, spec{wid: "dup", plain: plain})
	var active, peak int
	var mu sync.Mutex
	network := newNetwork(func(_ context.Context, _ Descriptor, f File) error {
		mu.Lock()
		active++
		peak = max(peak, active)
		mu.Unlock()
		time.Sleep(30 * time.Millisecond)
		err := simulate(f, plain)
		mu.Lock()
		active--
		mu.Unlock()
		return err
	})
	service := openService(t, t.TempDir(), 1<<20, nil, nil, network)
	var wg sync.WaitGroup
	results := make([]Image, 3)
	for i := range results {
		wg.Add(1)
		go func() {
			defer wg.Done()
			image, err := service.Download(id, ref)
			if err != nil {
				t.Error(err)
			}
			results[i] = image
		}()
	}
	wg.Wait()
	if network.networkCalls() != 1 || peak != 1 || results[0] != results[1] || results[1] != results[2] {
		t.Fatalf("calls=%d peak=%d %+v", network.networkCalls(), peak, results)
	}
	// A failed first attempt is followed by an explicit independent attempt.
	id2, ref2, _ := reference(t, spec{wid: "retry", plain: plain})
	attempts := 0
	network.script = func(_ context.Context, _ Descriptor, f File) error {
		attempts++
		if attempts == 1 {
			return errors.New("transient")
		}
		return simulate(f, plain)
	}
	_, err := service.Download(id2, ref2)
	wantCode(t, err, DownloadFailed)
	if _, err := service.Download(id2, ref2); err != nil || attempts != 2 {
		t.Fatalf("explicit retry: %v attempts=%d", err, attempts)
	}
}

// UT-IMG-14 / IT-IMG-14: delete and download run in admission order; the path reserves nothing.
func TestUTIMG14OrdersDownloadAndDeleteByAdmission(t *testing.T) {
	plain := payload(128)
	id, ref, _ := reference(t, spec{wid: "order", plain: plain})
	release := make(chan struct{})
	started := make(chan struct{}, 2)
	network := newNetwork(func(_ context.Context, _ Descriptor, f File) error {
		started <- struct{}{}
		<-release
		return simulate(f, plain)
	})
	service := openService(t, t.TempDir(), 1<<20, nil, nil, network)
	done := make(chan Image, 1)
	go func() { image, _ := service.Download(id, ref); done <- image }()
	<-started
	deleted := make(chan *Error, 1)
	go func() { deleted <- service.Delete(id) }() // admitted after the download: waits for it
	select {
	case <-deleted:
		t.Fatal("delete overtook the download")
	case <-time.After(50 * time.Millisecond):
	}
	close(release)
	image := <-done
	if err := <-deleted; err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(image.Path); !os.IsNotExist(err) {
		t.Fatal("delete admitted after the download left the file")
	}
	// Admitted before: delete first, the later download fetches it again.
	if err := service.Delete(id); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Download(id, ref); err != nil || network.networkCalls() != 2 {
		t.Fatalf("download after delete: %v calls=%d", err, network.networkCalls())
	}
	if _, err := os.Stat(image.Path); err != nil {
		t.Fatal("the new download must publish the same private path")
	}
}

// UT-IMG-15 / IT-IMG-15: cancellation does not wait for the queue; publication and retirement
// have a defined order.
func TestUTIMG15CancelAndPublishOrdering(t *testing.T) {
	plain := payload(128)
	t.Run("retirement cancels network without waiting for a turn and cleans the partial", func(t *testing.T) {
		dir := t.TempDir()
		id, ref, _ := reference(t, spec{wid: "c", plain: plain})
		started := make(chan struct{})
		network := newNetwork(func(ctx context.Context, _ Descriptor, f File) error {
			_, _ = f.Write([]byte("partial"))
			close(started)
			<-ctx.Done()
			return ctx.Err()
		})
		service := openService(t, dir, 1<<20, nil, nil, network)
		result := make(chan *Error, 1)
		go func() { _, err := service.Download(id, ref); result <- err }()
		<-started
		network.disconnect()
		select {
		case err := <-result:
			wantCode(t, err, DownloadFailed)
		case <-time.After(2 * time.Second):
			t.Fatal("cancellation waited")
		}
		if len(files(t, dir)) != 0 {
			t.Fatal("partial kept")
		}
	})
	t.Run("publication that won the race is kept", func(t *testing.T) {
		dir := t.TempDir()
		id, ref, _ := reference(t, spec{wid: "w", plain: plain})
		network := newNetwork(serving(plain))
		service := openService(t, dir, 1<<20, nil, nil, network)
		image, err := service.Download(id, ref)
		if err != nil {
			t.Fatal(err)
		}
		network.disconnect()
		if _, statErr := os.Stat(image.Path); statErr != nil {
			t.Fatal("retirement after publication removed the file")
		}
	})
	t.Run("retirement that won the race publishes nothing", func(t *testing.T) {
		dir := t.TempDir()
		id, ref, _ := reference(t, spec{wid: "l", plain: plain})
		network := newNetwork(nil)
		network.script = func(_ context.Context, _ Descriptor, f File) error {
			err := simulate(f, plain)
			network.current.retire() // retired after the bytes arrived, before publication
			return err
		}
		service := openService(t, dir, 1<<20, nil, nil, network)
		_, err := service.Download(id, ref)
		wantCode(t, err, DownloadFailed)
		if len(files(t, dir)) != 0 || service.Stats().UsedBytes != 0 {
			t.Fatalf("late result was published: %v", files(t, dir))
		}
	})
}

// UT-IMG-16 / IT-IMG-16: a queued request cannot start network on a retired generation, even if
// another one connected meanwhile, but it can still reuse a complete file.
func TestUTIMG16QueuedRequestsCannotUseARetiredGeneration(t *testing.T) {
	plain := payload(128)
	idA, refA, _ := reference(t, spec{wid: "a", plain: plain})
	idB, refB, _ := reference(t, spec{wid: "b", plain: plain})
	release := make(chan struct{})
	started := make(chan struct{})
	network := newNetwork(func(_ context.Context, d Descriptor, f File) error {
		if d.MessageID == idA {
			close(started)
			<-release
		}
		return simulate(f, plain)
	})
	dir := t.TempDir()
	service := openService(t, dir, 1<<20, nil, nil, network)
	// B already has a complete file; C needs the network.
	if err := os.WriteFile(filepath.Join(dir, fileName(idB)+completeSuffix), plain, 0o600); err != nil {
		t.Fatal(err)
	}
	service = openService(t, dir, 1<<20, nil, nil, network)
	idC, refC, _ := reference(t, spec{wid: "c", plain: plain})
	go func() { _, _ = service.Download(idA, refA) }()
	<-started
	reused := make(chan *Error, 1)
	fresh := make(chan *Error, 1)
	go func() { _, err := service.Download(idB, refB); reused <- err }()
	time.Sleep(20 * time.Millisecond)
	go func() { _, err := service.Download(idC, refC); fresh <- err }()
	time.Sleep(20 * time.Millisecond)
	network.disconnect()
	network.connect() // a new generation is connected before the queued requests get their turn
	close(release)
	if err := <-reused; err != nil {
		t.Fatalf("complete file could not be reused: %v", err)
	}
	wantCode(t, <-fresh, AccountNotConnected)
	if network.networkCalls() != 1 {
		t.Fatalf("queued request started network: %d", network.networkCalls())
	}
	// A new explicit call after the new generation connected succeeds.
	if _, err := service.Download(idC, refC); err != nil {
		t.Fatal(err)
	}
}

// IT-IMG-17: persistence keeps going during a download, complete files outlive logout and
// derived names cannot traverse paths.
func TestITIMG17FilesAreIndependentOfSessionAndNamesAreSafe(t *testing.T) {
	plain := payload(200)
	id, ref, _ := reference(t, spec{wid: "../../etc/passwd", plain: plain})
	dir := t.TempDir()
	network := newNetwork(serving(plain))
	service := openService(t, dir, 1<<20, nil, nil, network)
	image, err := service.Download(id, ref)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(image.Path) != dir || strings.Contains(filepath.Base(image.Path), "..") || len(filepath.Base(image.Path)) != 64+len(completeSuffix) {
		t.Fatalf("unsafe name %q", image.Path)
	}
	network.disconnect() // logout retires the generation
	service.SetNetwork(nil)
	reopened := openService(t, dir, 1<<20, nil, nil, nil)
	if got, err := reopened.Download(id, ref); err != nil || got.Path != image.Path {
		t.Fatalf("complete file lost after logout: %v", err)
	}
}

func TestOpenRejectsInvalidOptions(t *testing.T) {
	_, err := Open(Options{Dir: "", LimitBytes: 1})
	wantCode(t, err, InvalidInput)
	_, err = Open(Options{Dir: t.TempDir(), LimitBytes: 0})
	wantCode(t, err, InvalidInput)
	if _, err := io.Discard.Write(nil); err != nil {
		t.Fatal(err)
	}
}
