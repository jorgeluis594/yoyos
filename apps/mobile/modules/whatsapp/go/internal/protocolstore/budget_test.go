package protocolstore

import (
	"strings"
	"testing"
)

func resolvedInsert(message string) PendingInsert {
	return PendingInsert{DeliveryID: "wa-delivery:v1:00000000000000000000000000000001", AccountID: "123@lid", Source: "live", IdentityState: "resolved",
		Message: []byte(`{"id":"` + message + `"}`), Recovery: Recovery{MessageInfoJSON: `{}`, Items: []RecoveryItem{{Format: "history", PlaintextBase64: "AA=="}}}}
}

// UT-BUF-01: the size sums the serialized entry, encryption overhead and, for pendingLid, the identity reserve.
func TestUTBUF01EntrySizeSumsSerializedEncryptionAndReserve(t *testing.T) {
	resolved := resolvedInsert("a")
	size, err := EntrySize(resolved)
	if err != nil {
		t.Fatal(err)
	}
	longer := resolvedInsert(strings.Repeat("a", 1000))
	bigger, _ := EntrySize(longer)
	if bigger-size != 999 {
		t.Fatalf("serialized content not counted byte for byte: %d", bigger-size)
	}
	if size < EncryptionOverheadBytes+RecordSeparatorBytes {
		t.Fatal("encryption overhead not counted")
	}
	pending := resolved
	pending.IdentityState, pending.Message = "pendingLid", nil
	reserved, _ := EntrySize(pending)
	withoutMessage := size - int64(len(`"message":{"id":"a"},`))
	if reserved < withoutMessage+IdentityReserveBytes {
		t.Fatal("identity reserve not counted")
	}
}

// UT-BUF-02: the exact limit is admitted, one byte more is rejected, for one entry and for a batch.
func TestUTBUF02ExactLimitAdmitsAndOneByteMoreRejects(t *testing.T) {
	cases := []struct {
		name        string
		limit, used int64
		sizes       []int64
		want        Decision
	}{
		{"single exact", 100, 0, []int64{100}, Admit},
		{"single one over", 100, 0, []int64{101}, Reject},
		{"beside others exact", 100, 40, []int64{60}, Admit},
		{"beside others one over", 100, 40, []int64{61}, Wait},
		{"batch exact", 100, 0, []int64{30, 70}, Admit},
		{"batch one over", 100, 0, []int64{30, 71}, Reject},
		{"batch beside others", 100, 1, []int64{30, 70}, Wait},
	}
	for _, c := range cases {
		if got := Decide(c.limit, c.used, c.sizes...); got != c.want {
			t.Errorf("%s: %v, want %v", c.name, got, c.want)
		}
	}
}

// UT-BUF-04: an entry that exceeds the whole budget is Reject (never retried); a merely occupied buffer is Wait.
func TestUTBUF04DistinguishesIntrinsicallyOversizeFromTemporaryFull(t *testing.T) {
	if Decide(100, 0, 101) != Reject || Decide(100, 100, 1) != Wait || Decide(100, 100, 101) != Reject {
		t.Fatal("capacity classes confused")
	}
	if Decide(100, 0, -1) != Reject || Decide(1<<62, 0, 1<<62, 1<<62, 1<<62) != Reject {
		t.Fatal("overflow or negative size admitted")
	}
}
