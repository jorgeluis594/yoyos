package bridge

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"strings"
	"testing"
	"unicode"
	"unicode/utf8"
)

// The gomobile surface becomes Java/Kotlin and Objective-C/Swift. gobind lower-cases the first
// letter of a method, so a Go method named Wait becomes the Java `wait()`, which clashes with the
// final java.lang.Object.wait() and stops the whole Android binding from compiling. Nothing but a
// native build used to notice, so this test walks every exported name of the package and fails on
// the ones that collide with the root classes of either platform.
var reservedJava = map[string]string{
	"wait": "java.lang.Object.wait", "notify": "java.lang.Object.notify", "notifyAll": "java.lang.Object.notifyAll",
	"getClass": "java.lang.Object.getClass", "hashCode": "java.lang.Object.hashCode", "equals": "java.lang.Object.equals",
	"toString": "java.lang.Object.toString", "clone": "java.lang.Object.clone", "finalize": "java.lang.Object.finalize",
}

var reservedObjC = map[string]string{
	"description": "NSObject.description", "debugDescription": "NSObject.debugDescription", "hash": "NSObject.hash",
	"class": "NSObject.class", "superclass": "NSObject.superclass", "self": "NSObject.self", "isEqual": "NSObject.isEqual",
	"retain": "NSObject.retain", "release": "NSObject.release", "autorelease": "NSObject.autorelease",
	"retainCount": "NSObject.retainCount", "dealloc": "NSObject.dealloc", "zone": "NSObject.zone",
	"load": "NSObject.load", "initialize": "NSObject.initialize",
	"await": "the Swift contextual keyword await", "async": "the Swift contextual keyword async",
}

// ARC treats these prefixes (followed by an uppercase letter or nothing) as ownership families.
var objCFamilies = []string{"init", "new", "copy", "mutableCopy", "alloc"}

func lowerFirst(name string) string {
	r, size := utf8.DecodeRuneInString(name)
	return string(unicode.ToLower(r)) + name[size:]
}

// bindingNameProblem reports why a generated member name is unusable, or "".
func bindingNameProblem(member string) string {
	lower := lowerFirst(member)
	if owner, ok := reservedJava[lower]; ok {
		return lower + " collides with " + owner
	}
	if owner, ok := reservedObjC[lower]; ok {
		return lower + " collides with " + owner
	}
	for _, family := range objCFamilies {
		if rest, ok := strings.CutPrefix(lower, family); ok && (rest == "" || unicode.IsUpper([]rune(rest)[0])) {
			return lower + " starts the Objective-C ARC family " + family
		}
	}
	return ""
}

// fieldAccessors are the Java getters/setters gobind generates for an exported struct field.
func fieldAccessorProblem(field string) string {
	for _, accessor := range []string{"get" + field, "set" + field, "is" + field} {
		if owner, ok := reservedJava[accessor]; ok {
			return accessor + " collides with " + owner
		}
	}
	return bindingNameProblem(field)
}

func exportedBridgeMembers(t *testing.T) (members, fields []string) {
	t.Helper()
	files, err := parser.ParseDir(token.NewFileSet(), ".", func(info fs.FileInfo) bool {
		return !strings.HasSuffix(info.Name(), "_test.go")
	}, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, pkg := range files {
		for _, file := range pkg.Files {
			for _, decl := range file.Decls {
				switch d := decl.(type) {
				case *ast.FuncDecl:
					if !d.Name.IsExported() {
						continue
					}
					members = append(members, d.Name.Name)
				case *ast.GenDecl:
					for _, spec := range d.Specs {
						typeSpec, ok := spec.(*ast.TypeSpec)
						if !ok || !typeSpec.Name.IsExported() {
							continue
						}
						switch kind := typeSpec.Type.(type) {
						case *ast.InterfaceType:
							for _, method := range kind.Methods.List {
								for _, name := range method.Names {
									members = append(members, name.Name)
								}
							}
						case *ast.StructType:
							for _, field := range kind.Fields.List {
								for _, name := range field.Names {
									if name.IsExported() {
										fields = append(fields, name.Name)
									}
								}
							}
						}
					}
				}
			}
		}
	}
	return members, fields
}

func TestExportedBridgeNamesDoNotCollideWithJavaOrObjectiveC(t *testing.T) {
	members, fields := exportedBridgeMembers(t)
	if len(members) < 20 || len(fields) < 5 {
		t.Fatalf("the walk found too little of the surface: %d methods, %d fields", len(members), len(fields))
	}
	for _, name := range members {
		if problem := bindingNameProblem(name); problem != "" {
			t.Errorf("method %s: %s", name, problem)
		}
	}
	for _, name := range fields {
		if problem := fieldAccessorProblem(name); problem != "" {
			t.Errorf("field %s: %s", name, problem)
		}
	}
}

// The checker itself must flag what it is meant to flag.
func TestBindingNameCheckerRecognizesTheKnownCollisions(t *testing.T) {
	for _, name := range []string{"Wait", "Notify", "NotifyAll", "Equals", "HashCode", "ToString", "Clone", "Finalize", "Description", "Hash", "Init", "InitWithX", "New", "NewThing", "Copy", "CopyOf", "Retain", "Release", "Class", "Await"} {
		if bindingNameProblem(name) == "" {
			t.Errorf("%s was not flagged", name)
		}
	}
	for _, name := range []string{"Outcome", "Newest", "Initial", "Copyright", "Download", "Delete"} {
		if problem := bindingNameProblem(name); problem != "" {
			t.Errorf("%s flagged: %s", name, problem)
		}
	}
	if fieldAccessorProblem("Class") == "" {
		t.Error("a field named Class generates getClass()")
	}
}
