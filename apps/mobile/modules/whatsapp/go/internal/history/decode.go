package history

import (
	"errors"
	"fmt"

	"go.mau.fi/whatsmeow/proto/waHistorySync"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

// historyFields are the wire numbers, read from the generated descriptors, that this
// package either needs or counts. Everything else in a batch is dropped before parsing.
var historyFields = func() (f struct {
	conversations, pushnames, mappings protowire.Number
	keep                               map[protowire.Number]bool
	messages                           protowire.Number
	keepConversation                   map[protowire.Number]bool
}) {
	history := (&waHistorySync.HistorySync{}).ProtoReflect().Descriptor().Fields()
	conversation := (&waHistorySync.Conversation{}).ProtoReflect().Descriptor().Fields()
	number := func(fields protoreflect.FieldDescriptors, name string) protowire.Number {
		field := fields.ByName(protoreflect.Name(name))
		if field == nil {
			panic("history descriptor lacks field " + name)
		}
		return field.Number()
	}
	f.conversations, f.pushnames = number(history, "conversations"), number(history, "pushnames")
	f.mappings = number(history, "phoneNumberToLidMappings")
	f.messages = number(conversation, "messages")
	f.keep = map[protowire.Number]bool{}
	for _, name := range []string{"syncType", "conversations", "pushnames", "globalSettings", "phoneNumberToLidMappings", "companionMetaNonce", "nctSalt"} {
		f.keep[number(history, name)] = true
	}
	f.keepConversation = map[protowire.Number]bool{}
	for _, name := range []string{"ID", "messages", "tcToken", "tcTokenTimestamp", "tcTokenSenderTimestamp"} {
		f.keepConversation[number(conversation, name)] = true
	}
	return
}()

var (
	historyDescriptor      = (&waHistorySync.HistorySync{}).ProtoReflect().Descriptor()
	conversationDescriptor = (&waHistorySync.Conversation{}).ProtoReflect().Descriptor()
)

// kept says whether the admission reads a field of a message; only the top level of a batch and its
// conversations are pruned, everything below them is read whole.
func kept(md protoreflect.MessageDescriptor, number protowire.Number) bool {
	switch md {
	case historyDescriptor:
		return historyFields.keep[number]
	case conversationDescriptor:
		return historyFields.keepConversation[number]
	}
	return true
}

// Decode parses a decompressed history protobuf. Before the parser allocates anything, the wire
// is checked without building objects: repeated records are counted, each message record is
// bounded, and the total number of elements and the nesting depth of everything that will be
// parsed are bounded by walking the schema, so unknown and uncounted repeated fields cannot
// amplify. Everything the admission never reads (status messages, call logs, group
// participants, …) is neither counted nor parsed.
func Decode(raw []byte, l Limits) (*waHistorySync.HistorySync, error) {
	if err := scan(raw, l); err != nil {
		return nil, err
	}
	elements := 0
	if err := walk(raw, historyDescriptor, 1, &elements, l); err != nil {
		return nil, err
	}
	var history waHistorySync.HistorySync
	if err := (proto.UnmarshalOptions{RecursionLimit: l.MaxDepth + 1}).Unmarshal(compact(raw), &history); err != nil {
		return nil, errors.Join(ErrInvalid, err)
	}
	return &history, nil
}

// walk visits every field that will be parsed and, by the schema, those of its submessages,
// counting elements and depth. It allocates nothing, so a bomb costs one read to refuse.
func walk(raw []byte, md protoreflect.MessageDescriptor, depth int, elements *int, l Limits) error {
	if depth > l.MaxDepth {
		return limit("nesting depth", int64(l.MaxDepth))
	}
	fields := md.Fields()
	for rest := raw; len(rest) > 0; {
		number, kind, tag := protowire.ConsumeTag(rest)
		if tag < 0 {
			return errors.Join(ErrInvalid, protowire.ParseError(tag))
		}
		size := protowire.ConsumeFieldValue(number, kind, rest[tag:])
		if size < 0 {
			return errors.Join(ErrInvalid, protowire.ParseError(size))
		}
		if kept(md, number) {
			if *elements++; *elements > l.MaxElements {
				return limit("elements", int64(l.MaxElements))
			}
			if field := fields.ByNumber(number); field != nil && kind == protowire.BytesType && field.Message() != nil && !field.IsMap() {
				payload, _ := protowire.ConsumeBytes(rest[tag:])
				if err := walk(payload, field.Message(), depth+1, elements, l); err != nil {
					return err
				}
			}
		}
		rest = rest[tag+size:]
	}
	return nil
}

// scan counts the repeated records the admission is limited by and bounds each message record by
// the exact length of its payload. It copies nothing.
func scan(raw []byte, l Limits) error {
	var conversations, messages, mappings, pushnames int
	for rest := raw; len(rest) > 0; {
		number, kind, tag := protowire.ConsumeTag(rest)
		if tag < 0 {
			return errors.Join(ErrInvalid, protowire.ParseError(tag))
		}
		size := protowire.ConsumeFieldValue(number, kind, rest[tag:])
		if size < 0 {
			return errors.Join(ErrInvalid, protowire.ParseError(size))
		}
		switch {
		case number == historyFields.conversations && kind == protowire.BytesType:
			if conversations++; conversations > l.MaxConversations {
				return limit("conversations", int64(l.MaxConversations))
			}
			payload, _ := protowire.ConsumeBytes(rest[tag:])
			count, err := countMessages(payload, l)
			if err != nil {
				return err
			}
			if messages += count; messages > l.MaxMessages {
				return limit("messages", int64(l.MaxMessages))
			}
		case number == historyFields.pushnames:
			if pushnames++; pushnames > l.MaxPushNames {
				return limit("push names", int64(l.MaxPushNames))
			}
		case number == historyFields.mappings:
			if mappings++; mappings > l.MaxMappings {
				return limit("mappings", int64(l.MaxMappings))
			}
		}
		rest = rest[tag+size:]
	}
	return nil
}

func countMessages(conversation []byte, l Limits) (int, error) {
	count := 0
	for rest := conversation; len(rest) > 0; {
		number, kind, tag := protowire.ConsumeTag(rest)
		if tag < 0 {
			return 0, errors.Join(ErrInvalid, protowire.ParseError(tag))
		}
		size := protowire.ConsumeFieldValue(number, kind, rest[tag:])
		if size < 0 {
			return 0, errors.Join(ErrInvalid, protowire.ParseError(size))
		}
		if number == historyFields.messages && kind == protowire.BytesType {
			payload, _ := protowire.ConsumeBytes(rest[tag:])
			if count++; count > l.MaxMessages {
				return 0, limit("messages", int64(l.MaxMessages))
			}
			if len(payload) > l.MaxRecordBytes {
				return 0, limit(fmt.Sprintf("record size of message %d", count), int64(l.MaxRecordBytes))
			}
		}
		rest = rest[tag+size:]
	}
	return count, nil
}

// compact returns the wire without the fields the admission never reads. When nothing is dropped it
// returns raw itself; otherwise it copies once, into a buffer of the exact final size.
func compact(raw []byte) []byte {
	size, dropped := compactSize(raw)
	if !dropped {
		return raw
	}
	return appendCompact(make([]byte, 0, size), raw)
}

func compactSize(raw []byte) (total int, dropped bool) {
	for rest := raw; len(rest) > 0; {
		number, kind, tag := protowire.ConsumeTag(rest)
		size := protowire.ConsumeFieldValue(number, kind, rest[tag:])
		switch {
		case !historyFields.keep[number]:
			dropped = true
		case number == historyFields.conversations && kind == protowire.BytesType:
			payload, _ := protowire.ConsumeBytes(rest[tag:])
			inner := conversationSize(payload)
			if inner != len(payload) {
				dropped = true
			}
			total += tag + protowire.SizeBytes(inner)
		default:
			total += tag + size
		}
		rest = rest[tag+size:]
	}
	return total, dropped
}

func conversationSize(conversation []byte) (total int) {
	for rest := conversation; len(rest) > 0; {
		number, kind, tag := protowire.ConsumeTag(rest)
		size := protowire.ConsumeFieldValue(number, kind, rest[tag:])
		if historyFields.keepConversation[number] {
			total += tag + size
		}
		rest = rest[tag+size:]
	}
	return total
}

func appendCompact(out, raw []byte) []byte {
	for rest := raw; len(rest) > 0; {
		number, kind, tag := protowire.ConsumeTag(rest)
		size := protowire.ConsumeFieldValue(number, kind, rest[tag:])
		switch {
		case !historyFields.keep[number]:
		case number == historyFields.conversations && kind == protowire.BytesType:
			payload, _ := protowire.ConsumeBytes(rest[tag:])
			out = protowire.AppendTag(out, number, protowire.BytesType)
			out = protowire.AppendVarint(out, uint64(conversationSize(payload)))
			for inner := payload; len(inner) > 0; {
				n, k, t := protowire.ConsumeTag(inner)
				s := protowire.ConsumeFieldValue(n, k, inner[t:])
				if historyFields.keepConversation[n] {
					out = append(out, inner[:t+s]...)
				}
				inner = inner[t+s:]
			}
		default:
			out = append(out, rest[:tag+size]...)
		}
		rest = rest[tag+size:]
	}
	return out
}
