package images

import "sync"

// budget is the global image byte account: every file in the directory (complete, foreign or a
// partial whose removal failed) plus the single active download, counted at the larger of its
// reservation and its real size. All state is guarded by one mutex.
type budget struct {
	mu       sync.Mutex
	limit    int64
	files    map[string]int64
	reserved int64 // forecast of the active download
	active   int64 // real size of the active download's temporary file
	running  bool
}

func newBudget(limit int64) *budget { return &budget{limit: limit, files: map[string]int64{}} }

func (b *budget) filesLocked() int64 {
	var total int64
	for _, size := range b.files {
		total += size
	}
	return total
}

func (b *budget) activeLocked() int64 {
	if !b.running {
		return 0
	}
	return max(b.reserved, b.active)
}

func (b *budget) usedLocked() int64 { return b.filesLocked() + b.activeLocked() }

// reserve claims the forecast for a download; it fails when the forecast does not fit.
func (b *budget) reserve(forecast int64) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	if forecast < 0 || forecast > b.limit-b.filesLocked() {
		return false
	}
	b.running, b.reserved, b.active = true, forecast, 0
	return true
}

// available is what a download with an unknown size may claim.
func (b *budget) available() int64 {
	b.mu.Lock()
	defer b.mu.Unlock()
	return max(0, b.limit-b.filesLocked())
}

// fits reports whether the active file may reach size bytes.
func (b *budget) fits(size int64) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	if size < 0 {
		return false
	}
	return b.filesLocked()+max(b.reserved, size) <= b.limit
}

func (b *budget) setActive(size int64) {
	b.mu.Lock()
	b.active = size
	b.mu.Unlock()
}

// finish ends the active download and, when its temporary file stayed on disk, keeps counting it.
func (b *budget) finish(stuckName string, stuckSize int64) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.running, b.reserved, b.active = false, 0, 0
	if stuckName != "" {
		b.files[stuckName] = stuckSize
	}
}

func (b *budget) put(name string, size int64) {
	b.mu.Lock()
	b.files[name] = size
	b.mu.Unlock()
}

func (b *budget) drop(name string) {
	b.mu.Lock()
	delete(b.files, name)
	b.mu.Unlock()
}

func (b *budget) size(name string) (int64, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	size, ok := b.files[name]
	return size, ok
}
