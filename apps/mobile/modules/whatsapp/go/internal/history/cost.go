package history

import (
	"reflect"
	"sync"

	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
)

// The parser materializes one Go struct per submessage, however few bytes it took on the wire: an
// empty submessage costs 2–3 bytes of input and hundreds of bytes of heap. Counting elements
// therefore does not bound memory; the estimated heap does. The estimate is the size of the
// generated Go struct of every submessage plus the slice slot that holds it, and the payload plus
// its header for strings and bytes. It is charged while the schema is walked, before anything is allocated.
var structSizes sync.Map // protoreflect.FullName -> int

const (
	pointerSlot    = 16 // the slice element and amortized growth
	headerBytes    = 64 // string/bytes header, allocation rounding and the garbage of slice growth
	packedPerInput = 8  // a packed varint of one byte decodes into up to a 64-bit slot
	unknownStruct  = 512
)

func structSize(md protoreflect.MessageDescriptor) int {
	if size, ok := structSizes.Load(md.FullName()); ok {
		return size.(int)
	}
	size := unknownStruct
	if mt, err := protoregistry.GlobalTypes.FindMessageByName(md.FullName()); err == nil {
		size = int(reflect.TypeOf(mt.New().Interface()).Elem().Size())
	}
	structSizes.Store(md.FullName(), size)
	return size
}

// elementCost estimates the heap one occurrence of a field adds when parsed.
func elementCost(field protoreflect.FieldDescriptor, kind protowire.Type, payload int) int {
	switch {
	case field == nil:
		return payload + headerBytes // unknown fields are kept as raw bytes
	case field.IsMap():
		return payload*4 + 2*headerBytes
	case field.Message() != nil && kind == protowire.BytesType:
		return structSize(field.Message()) + pointerSlot
	case kind == protowire.BytesType && field.IsList() && packable(field.Kind()):
		return payload*packedPerInput + headerBytes
	case kind == protowire.BytesType:
		return payload + headerBytes
	default:
		return pointerSlot
	}
}

func packable(kind protoreflect.Kind) bool {
	return kind != protoreflect.StringKind && kind != protoreflect.BytesKind && kind != protoreflect.MessageKind && kind != protoreflect.GroupKind
}
