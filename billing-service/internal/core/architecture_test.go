package core_test

import (
	"bufio"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

const modulePathOfThisService = "github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service"

// The core is the hexagon: it imports the Go standard library and other core
// packages, never a framework, a driver or anything in infra.
func TestCoreImportsOnlyTheStandardLibraryAndCorePackages(t *testing.T) {
	modulePath := readModulePath(t, filepath.Join("..", "..", "go.mod"))
	if modulePath != modulePathOfThisService {
		t.Fatalf("go.mod declares module %q, want %q", modulePath, modulePathOfThisService)
	}

	violations, err := importViolations(".", modulePath)
	if err != nil {
		t.Fatal(err)
	}
	if len(violations) > 0 {
		t.Fatalf("core must import only the standard library and core packages:\n%s", strings.Join(violations, "\n"))
	}
}

func TestImportViolationsReportsForeignImportsOfACoreFile(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "ok.go"), `package x
import ("fmt"; "net/http"; "github.com/acme/billing/internal/core/shared/domain")
var _ = fmt.Sprint
var _ http.Handler
var _ domain.Error
`)
	writeFile(t, filepath.Join(root, "bad.go"), `package x
import (
	_ "github.com/jackc/pgx/v5"
	_ "github.com/acme/billing/internal/infra/persistence"
)
`)

	violations, err := importViolations(root, "github.com/acme/billing")
	if err != nil {
		t.Fatal(err)
	}

	got := strings.Join(violations, "\n")
	for _, want := range []string{"github.com/jackc/pgx/v5", "github.com/acme/billing/internal/infra/persistence"} {
		if !strings.Contains(got, want) {
			t.Errorf("violations %q should mention %q", got, want)
		}
	}
	if strings.Contains(got, "ok.go") {
		t.Errorf("ok.go imports only allowed packages but was reported: %q", got)
	}
}

func importViolations(root, modulePath string) ([]string, error) {
	corePrefix := modulePath + "/internal/core/"
	var violations []string
	fset := token.NewFileSet()

	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil || entry.IsDir() || !strings.HasSuffix(path, ".go") {
			return walkErr
		}
		file, err := parser.ParseFile(fset, path, nil, parser.ImportsOnly)
		if err != nil {
			return err
		}
		for _, spec := range file.Imports {
			importPath, err := strconv.Unquote(spec.Path.Value)
			if err != nil {
				return err
			}
			if !isStandardLibrary(importPath) && !strings.HasPrefix(importPath, corePrefix) {
				violations = append(violations, path+" imports "+importPath)
			}
		}
		return nil
	})
	return violations, err
}

// Standard library paths have no dot in their first element (net/http, not github.com/...).
func isStandardLibrary(importPath string) bool {
	first, _, _ := strings.Cut(importPath, "/")
	return !strings.Contains(first, ".")
}

func readModulePath(t *testing.T, goMod string) string {
	t.Helper()
	file, err := os.Open(goMod)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		if path, ok := strings.CutPrefix(scanner.Text(), "module "); ok {
			return strings.TrimSpace(path)
		}
	}
	t.Fatalf("no module line in %s", goMod)
	return ""
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}
