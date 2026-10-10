package history

import (
	"errors"
	"fmt"
	"strings"

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
	return
}()

// Decode parses a decompressed history protobuf. Counts and record sizes are checked on the
// wire, without building objects, before the parser allocates any collection; fields the
// admission never reads (such as status messages or call logs) are not parsed at all, and
// nesting deeper than MaxDepth is refused by the parser itself.
func Decode(raw []byte, l Limits) (*waHistorySync.HistorySync, error) {
	kept, err := scan(raw, l)
	if err != nil {
		return nil, err
	}
	var history waHistorySync.HistorySync
	if err := (proto.UnmarshalOptions{RecursionLimit: l.MaxDepth}).Unmarshal(kept, &history); err != nil {
		if isDepth(err) {
			return nil, limit("nesting depth", int64(l.MaxDepth))
		}
		return nil, errors.Join(ErrInvalid, err)
	}
	return &history, nil
}

func isDepth(err error) bool { return strings.Contains(err.Error(), "recursion depth") }

// scan walks the top level of the batch once and returns the bytes worth parsing.
func scan(raw []byte, l Limits) ([]byte, error) {
	var conversations, messages, mappings, pushnames int
	var kept []byte
	dropped := false
	for rest := raw; len(rest) > 0; {
		number, kind, tag := protowire.ConsumeTag(rest)
		if tag < 0 {
			return nil, errors.Join(ErrInvalid, protowire.ParseError(tag))
		}
		size := protowire.ConsumeFieldValue(number, kind, rest[tag:])
		if size < 0 {
			return nil, errors.Join(ErrInvalid, protowire.ParseError(size))
		}
		field := rest[:tag+size]
		switch {
		case number == historyFields.conversations && kind == protowire.BytesType:
			conversations++
			if conversations > l.MaxConversations {
				return nil, limit("conversations", int64(l.MaxConversations))
			}
			payload, _ := protowire.ConsumeBytes(rest[tag:])
			count, err := scanConversation(payload, l)
			if err != nil {
				return nil, err
			}
			if messages += count; messages > l.MaxMessages {
				return nil, limit("messages", int64(l.MaxMessages))
			}
		case number == historyFields.pushnames:
			if pushnames++; pushnames > l.MaxPushNames {
				return nil, limit("push names", int64(l.MaxPushNames))
			}
		case number == historyFields.mappings:
			if mappings++; mappings > l.MaxMappings {
				return nil, limit("mappings", int64(l.MaxMappings))
			}
		}
		if historyFields.keep[number] {
			kept = append(kept, field...)
		} else {
			dropped = true
		}
		rest = rest[tag+size:]
	}
	if !dropped {
		return raw, nil
	}
	return kept, nil
}

// scanConversation counts the message records of one conversation and bounds each record.
func scanConversation(conversation []byte, l Limits) (int, error) {
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
			if count++; count > l.MaxMessages {
				return 0, limit("messages", int64(l.MaxMessages))
			}
			if size-tag > l.MaxRecordBytes {
				return 0, limit(fmt.Sprintf("record size of message %d", count), int64(l.MaxRecordBytes))
			}
		}
		rest = rest[tag+size:]
	}
	return count, nil
}
