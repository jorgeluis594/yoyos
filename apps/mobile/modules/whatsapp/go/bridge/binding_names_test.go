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

// A Go type becomes a Java class and an Objective-C class named after it. A type that shares its
// simple name with a java.lang class the generated code uses unqualified (Object, String, Error,
// Exception, ...) shadows it inside the generated package, and one named like a Foundation root
// class cannot coexist with it once the prefix is stripped.
var reservedTypes = map[string]string{
	"Object": "java.lang.Object", "String": "java.lang.String", "Class": "java.lang.Class", "Error": "java.lang.Error",
	"Exception": "java.lang.Exception", "Throwable": "java.lang.Throwable", "Runnable": "java.lang.Runnable",
	"Thread": "java.lang.Thread", "Integer": "java.lang.Integer", "Long": "java.lang.Long", "Boolean": "java.lang.Boolean",
	"Number": "java.lang.Number", "Void": "java.lang.Void", "System": "java.lang.System", "Math": "java.lang.Math",
	"NSObject": "Foundation.NSObject", "NSString": "Foundation.NSString", "NSError": "Foundation.NSError",
	"Protocol": "the Objective-C Protocol class", "Seq": "the gomobile runtime class Seq",
}

// typeNameProblem reports why a generated class name is unusable, or "".
func typeNameProblem(name string) string {
	if owner, ok := reservedTypes[name]; ok {
		return name + " collides with " + owner
	}
	if strings.HasPrefix(name, "NS") && len(name) > 2 && unicode.IsUpper([]rune(name)[2]) {
		return name + " imitates the Foundation NS prefix"
	}
	return ""
}

func exportedBridgeTypes(t *testing.T) []string {
	t.Helper()
	files, err := parser.ParseDir(token.NewFileSet(), ".", func(info fs.FileInfo) bool {
		return !strings.HasSuffix(info.Name(), "_test.go")
	}, 0)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, pkg := range files {
		for _, file := range pkg.Files {
			for _, decl := range file.Decls {
				if d, ok := decl.(*ast.GenDecl); ok {
					for _, spec := range d.Specs {
						if typeSpec, ok := spec.(*ast.TypeSpec); ok && typeSpec.Name.IsExported() {
							names = append(names, typeSpec.Name.Name)
						}
					}
				}
			}
		}
	}
	return names
}

// m10 (WA-10 review): the walk above checked members only; type names generate classes too.
func TestExportedBridgeTypeNamesDoNotCollideWithJavaOrObjectiveC(t *testing.T) {
	names := exportedBridgeTypes(t)
	if len(names) < 10 {
		t.Fatalf("the walk found too few types: %v", names)
	}
	for _, name := range names {
		if problem := typeNameProblem(name); problem != "" {
			t.Errorf("type %s: %s", name, problem)
		}
	}
}

func TestTypeNameCheckerRecognizesTheKnownCollisions(t *testing.T) {
	for _, name := range []string{"Object", "String", "Error", "Exception", "NSObject", "NSThing", "Seq"} {
		if typeNameProblem(name) == "" {
			t.Errorf("%s was not flagged", name)
		}
	}
	for _, name := range []string{"ImageSession", "ImageOperation", "DeliverySession", "ConnectionSession", "Nsfw", "NS"} {
		if problem := typeNameProblem(name); problem != "" {
			t.Errorf("%s flagged: %s", name, problem)
		}
	}
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
