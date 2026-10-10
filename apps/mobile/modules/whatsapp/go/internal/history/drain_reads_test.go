package history

import (
	"context"
	"testing"

	"yoyos-whatsapp/internal/protocolstore"
)

type countingLedger struct{ reads int }

func (c *countingLedger) Pending() ([]protocolstore.PendingRecord, error) {
	c.reads++
	return nil, nil
}
func (c *countingLedger) Retire(string) (bool, error) { return false, nil }

// m4 (review of PR #52): a pass decodes the ledger snapshot once, not once for the purge of
// other accounts' captures and again to look for its own.
func TestDrainReadsTheLedgerOnce(t *testing.T) {
	ledger := &countingLedger{}
	p := NewProcessor(func() string { return "123@lid" }, func() Env { return Env{} }, DefaultLimits(), nil, nil, ledger, nil, Hooks{})
	if err := p.Drain(context.Background()); err != nil {
		t.Fatal(err)
	}
	if ledger.reads != 1 {
		t.Fatalf("reads: %d", ledger.reads)
	}
}
