package images

import (
	"context"
	"os"
	"testing"
	"time"
)

// IT-CFG-06 (images): a limit reduced below what is stored keeps every complete file readable,
// reusable without network and deletable; new downloads wait for the excess to drain.
func TestITCFG06ReducedImageLimitKeepsDataAndDrainsByDeleting(t *testing.T) {
	dir := t.TempDir()
	plain := payload(400)
	idA, refA, _ := reference(t, spec{wid: "a", plain: plain})
	idB, refB, _ := reference(t, spec{wid: "b", plain: plain})
	network := newNetwork(serving(plain))
	service := openService(t, dir, 1<<20, nil, nil, network)
	first, err := service.Download(idA, refA)
	if err != nil {
		t.Fatal(err)
	}

	if !service.SetLimit(100) {
		t.Fatal("a smaller limit is accepted")
	}
	if got := service.Stats(); got.UsedBytes != 400 || got.Files != 1 {
		t.Fatalf("nothing is discarded by a reduction: %+v", got)
	}
	// Reuse needs no network and no budget.
	network.disconnect()
	again, err := service.Download(idA, refA)
	if err != nil || again.Path != first.Path {
		t.Fatalf("complete file reused over the reduced limit: %+v %v", again, err)
	}
	if _, statErr := os.Stat(first.Path); statErr != nil {
		t.Fatal("file still readable")
	}
	// A new image does not fit beside the excess, and nothing is downloaded for it.
	network.connect()
	calls := network.networkCalls()
	_, err = service.Download(idB, refB)
	wantCode(t, err, StorageLimitReached)
	if network.networkCalls() != calls {
		t.Fatal("no network for a download that cannot fit")
	}
	// Deleting drains the excess; the same download then fits again.
	if err := service.Delete(idA); err != nil {
		t.Fatal(err)
	}
	if got := service.Stats().UsedBytes; got != 0 {
		t.Fatalf("drained: %d", got)
	}
	service.SetLimit(1 << 20)
	if _, err := service.Download(idB, refB); err != nil {
		t.Fatal(err)
	}
}

// IT-CFG-06: the reduced limit also holds after a restart; the files are still counted and usable.
func TestITCFG06ReducedLimitSurvivesRestart(t *testing.T) {
	dir := t.TempDir()
	plain := payload(400)
	id, ref, _ := reference(t, spec{wid: "r", plain: plain})
	first := openService(t, dir, 1<<20, nil, nil, newNetwork(serving(plain)))
	if _, err := first.Download(id, ref); err != nil {
		t.Fatal(err)
	}
	second := openService(t, dir, 100, nil, nil, nil)
	if got := second.Stats(); got.UsedBytes != 400 {
		t.Fatalf("excess counted after restart: %+v", got)
	}
	if _, err := second.Download(id, ref); err != nil {
		t.Fatalf("reusable after restart with no network: %v", err)
	}
	if err := second.Delete(id); err != nil || second.Stats().UsedBytes != 0 {
		t.Fatalf("deletable after restart: %v %+v", err, second.Stats())
	}
}

// IT-CFG-08: the limit change takes its turn behind a cancelled download, so it waits for that
// download's cleanup; it holds nothing else while it waits and applies afterwards.
func TestITCFG08LimitChangeWaitsForTheCleanupOfACancelledDownload(t *testing.T) {
	dir := t.TempDir()
	plain := payload(128)
	id, ref, _ := reference(t, spec{wid: "c", plain: plain})
	started := make(chan struct{})
	network := newNetwork(func(ctx context.Context, _ Descriptor, f File) error {
		_, _ = f.Write([]byte("partial"))
		close(started)
		<-ctx.Done()
		return ctx.Err()
	})
	release, removing := make(chan struct{}), make(chan struct{}, 1)
	filesystem := &faultyFS{}
	filesystem.setRemove(func(string) error {
		removing <- struct{}{}
		<-release
		return nil // the real removal still runs afterwards
	})
	service := openService(t, dir, 1<<20, filesystem, nil, network)
	download := service.BeginDownload(id, ref)
	<-started
	network.disconnect()
	<-removing // the cancelled download is cleaning its partial

	change := service.BeginSetLimit(64)
	select {
	case <-change.done:
		t.Fatal("the change must wait for the cleanup")
	case <-time.After(50 * time.Millisecond):
	}
	if service.budget.available() < 1<<19 {
		t.Fatal("the old limit applies until the change takes its turn")
	}
	close(release)
	if _, err := change.Wait(); err != nil {
		t.Fatal(err)
	}
	if _, err := download.Wait(); err == nil {
		t.Fatal("the cancelled download failed")
	}
	if len(files(t, dir)) != 0 || service.Stats().UsedBytes != 0 {
		t.Fatalf("clean before and after the change: %v %+v", files(t, dir), service.Stats())
	}
	if service.budget.available() != 64 {
		t.Fatalf("new limit applied: %d", service.budget.available())
	}
}

// IT-CFG-08: changes are serialized in admission order (the last one wins) and an invalid limit
// is refused without changing the current one.
func TestITCFG08LimitChangesAreSerializedAndValidated(t *testing.T) {
	service := openService(t, t.TempDir(), 1000, nil, nil, nil)
	first, second := service.BeginSetLimit(200), service.BeginSetLimit(300)
	if _, err := first.Wait(); err != nil {
		t.Fatal(err)
	}
	if _, err := second.Wait(); err != nil {
		t.Fatal(err)
	}
	if got := service.budget.available(); got != 300 {
		t.Fatalf("last admitted change wins: %d", got)
	}
	for _, bad := range []int64{0, -1} {
		_, err := service.BeginSetLimit(bad).Wait()
		wantCode(t, err, InvalidInput)
	}
	if got := service.budget.available(); got != 300 {
		t.Fatalf("refused changes leave the limit: %d", got)
	}
}

// m11 (WA-10 review): the queue of image operations is bounded, so a stalled transfer cannot make
// the number of parked goroutines grow with every new call. Refused calls fail without queuing.
func TestM11ImageOperationQueueIsBounded(t *testing.T) {
	plain := payload(128)
	id, ref, _ := reference(t, spec{wid: "q", plain: plain})
	stalled, release := make(chan struct{}), make(chan struct{})
	network := newNetwork(func(ctx context.Context, _ Descriptor, f File) error {
		close(stalled)
		select {
		case <-release:
		case <-ctx.Done():
		}
		return simulate(f, plain)
	})
	service := openService(t, t.TempDir(), 1<<20, nil, nil, network)
	first := service.BeginDownload(id, ref)
	<-stalled
	var waiting []*Pending
	for i := 1; i < MaxQueuedOperations; i++ { // the stalled download plus these fill the queue
		waiting = append(waiting, service.BeginDelete(id))
	}
	_, err := service.BeginDelete(id).Wait()
	wantCode(t, err, DeleteFailed)
	_, err = service.BeginDownload(id, ref).Wait()
	wantCode(t, err, DownloadFailed)
	limit := service.BeginSetLimit(2 << 20)
	close(release)
	if _, err := first.Wait(); err != nil {
		t.Fatal(err)
	}
	for _, pending := range waiting {
		if _, err := pending.Wait(); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := limit.Wait(); err != nil {
		t.Fatalf("a limit change is never refused for being busy: %v", err)
	}
	if _, err := service.BeginDelete(id).Wait(); err != nil {
		t.Fatalf("the queue accepts operations again once it drained: %v", err)
	}
}
