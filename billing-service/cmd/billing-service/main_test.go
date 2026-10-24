package main

import (
	"bytes"
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/twmb/franz-go/pkg/kfake"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/testsupport"
)

var binary string

func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "billing-service-bin")
	if err != nil {
		panic(err)
	}
	binary = filepath.Join(dir, "billing-service")
	build := exec.Command("go", "build", "-o", binary, ".")
	build.Stderr = os.Stderr
	if err := build.Run(); err != nil {
		panic(err)
	}

	code := m.Run()
	testsupport.Terminate()
	os.RemoveAll(dir)
	os.Exit(code)
}

func freePort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port
}

func environment(overrides map[string]string) []string {
	env := []string{"PATH=" + os.Getenv("PATH"), "HOME=" + os.Getenv("HOME")}
	for key, value := range overrides {
		env = append(env, key+"="+value)
	}
	return env
}

// BOOT-04: an invalid variable ends the process with a non-zero status and an
// error that names the variable but not its value.
func TestAnInvalidVariableEndsTheProcessNamingItWithoutItsValue(t *testing.T) {
	command := exec.Command(binary)
	command.Env = environment(map[string]string{
		"PORT":              "not-a-port-9f3a",
		"DATABASE_URL":      "postgresql://billing:hunter2-77c1@127.0.0.1:5435/billing",
		"PSP_WEBHOOK_TOKEN": "test-webhook-token",
	})
	var stderr bytes.Buffer
	command.Stderr = &stderr

	err := command.Run()

	var exit *exec.ExitError
	if !errors.As(err, &exit) || exit.ExitCode() == 0 {
		t.Fatalf("exit = %v, want a non-zero exit status", err)
	}
	if !strings.Contains(stderr.String(), "PORT") {
		t.Errorf("stderr %q does not name PORT", stderr.String())
	}
	for _, secret := range []string{"not-a-port-9f3a", "hunter2-77c1"} {
		if strings.Contains(stderr.String(), secret) {
			t.Errorf("stderr %q prints %q", stderr.String(), secret)
		}
	}
}

func TestAMissingDatabaseURLEndsTheProcessNamingIt(t *testing.T) {
	command := exec.Command(binary)
	command.Env = environment(nil)
	var stderr bytes.Buffer
	command.Stderr = &stderr

	err := command.Run()

	var exit *exec.ExitError
	if !errors.As(err, &exit) || exit.ExitCode() == 0 || !strings.Contains(stderr.String(), "DATABASE_URL") {
		t.Fatalf("exit = %v, stderr = %q, want a non-zero exit naming DATABASE_URL", err, stderr.String())
	}
}

// BOOT-06 and BOOT-07: SIGTERM stops the service within 10 s with status 0, and
// the healthcheck subcommand that Docker runs follows the service.
func TestSigtermStopsTheServiceWithinTenSecondsAndTheHealthcheckFollowsIt(t *testing.T) {
	cluster, err := kfake.NewCluster(kfake.NumBrokers(1))
	if err != nil {
		t.Fatal(err)
	}
	defer cluster.Close()
	port := strconv.Itoa(freePort(t))
	env := environment(map[string]string{
		"PORT":               port,
		"DATABASE_URL":       testsupport.NewDatabase(t),
		"KAFKA_BROKERS":      strings.Join(cluster.ListenAddrs(), ","),
		"OTEL_COLLECTOR_URL": "http://127.0.0.1:1",
		"PSP_WEBHOOK_TOKEN":  "test-webhook-token",
	})

	service := exec.Command(binary)
	service.Env = env
	if err := service.Start(); err != nil {
		t.Fatal(err)
	}
	exited := make(chan error, 1)
	go func() { exited <- service.Wait() }()
	defer service.Process.Kill()

	healthy := false
	for deadline := time.Now().Add(30 * time.Second); time.Now().Before(deadline) && !healthy; time.Sleep(100 * time.Millisecond) {
		if response, err := http.Get("http://127.0.0.1:" + port + "/health"); err == nil {
			response.Body.Close()
			healthy = response.StatusCode == http.StatusOK
		}
	}
	if !healthy {
		t.Fatal("the service did not become healthy within 30s")
	}
	if code := runHealthcheck(env); code != 0 {
		t.Fatalf("healthcheck exit code = %d while the service is up, want 0", code)
	}

	started := time.Now()
	if err := service.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-exited:
		if err != nil {
			t.Fatalf("the service exited with %v after SIGTERM, want status 0", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the service did not exit within 10s of SIGTERM")
	}
	if elapsed := time.Since(started); elapsed > 10*time.Second {
		t.Fatalf("shutdown took %v, want at most 10s", elapsed)
	}

	if code := runHealthcheck(env); code == 0 {
		t.Fatal("healthcheck exit code = 0 after the service stopped, want non-zero")
	}
}

// BOOT-07: the healthcheck of the image fails when the service answers anything but 200, and when PORT is not a number.
func TestHealthcheckFailsWhenTheServiceIsNotHealthy(t *testing.T) {
	unhealthy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusServiceUnavailable) }))
	defer unhealthy.Close()
	port := strconv.Itoa(unhealthy.Listener.Addr().(*net.TCPAddr).Port)

	if code := runHealthcheck(environment(map[string]string{"PORT": port})); code != 1 {
		t.Errorf("healthcheck exit code = %d against a service that answers 503, want 1", code)
	}
	if code := runHealthcheck(environment(map[string]string{"PORT": "not-a-port"})); code != 1 {
		t.Errorf("healthcheck exit code = %d with a PORT that is not a number, want 1", code)
	}
}

func runHealthcheck(env []string) int {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, binary, "healthcheck")
	command.Env = env
	err := command.Run()
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		return exit.ExitCode()
	}
	if err != nil {
		return -1
	}
	return 0
}
