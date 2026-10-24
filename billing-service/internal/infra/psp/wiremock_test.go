package psp_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/moby/moby/api/types/container"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/model"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/invoice/port/out"
	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/infra/psp"
)

// These tests run the adapter against the WireMock of the compose file, loaded with the real
// mappings of docker/wiremock, so the contract the adapter speaks is the one the demo serves.

const (
	wiremockImage = "wiremock/wiremock:3.13.2"
	webhookToken  = "psp-demo-token"
	mappingsFile  = "../../../../docker/wiremock/mappings/psp.json"
	outageFile    = "../../../../docker/wiremock/scenarios/psp-outage.json"
)

var (
	wiremockOnce      sync.Once
	wiremockContainer testcontainers.Container
	wiremockURL       string
	wiremockErr       error
)

func TestMain(m *testing.M) {
	code := m.Run()
	if wiremockContainer != nil {
		_ = testcontainers.TerminateContainer(wiremockContainer)
	}
	os.Exit(code)
}

// wiremock returns the URL of the WireMock container that the whole test binary shares.
func wiremock(t *testing.T) string {
	t.Helper()
	wiremockOnce.Do(func() {
		ctx := context.Background()
		mappings, err := filepath.Abs(mappingsFile)
		if err != nil {
			wiremockErr = err
			return
		}
		wiremockContainer, wiremockErr = testcontainers.Run(ctx, wiremockImage,
			testcontainers.WithExposedPorts("8080/tcp"),
			testcontainers.WithFiles(testcontainers.ContainerFile{
				HostFilePath:      mappings,
				ContainerFilePath: "/home/wiremock/mappings/psp.json",
				FileMode:          0o644,
			}),
			// The webhooks of the mappings call back the test, which runs on the host.
			testcontainers.WithHostConfigModifier(func(hostConfig *container.HostConfig) {
				hostConfig.ExtraHosts = append(hostConfig.ExtraHosts, "host.docker.internal:host-gateway")
			}),
			testcontainers.WithWaitStrategy(wait.ForHTTP("/__admin/mappings").WithPort("8080/tcp").WithStartupTimeout(3*time.Minute)),
		)
		if wiremockErr != nil {
			return
		}
		wiremockURL, wiremockErr = wiremockContainer.PortEndpoint(ctx, "8080/tcp", "http")
	})
	if wiremockErr != nil {
		t.Fatalf("start the WireMock container (is Docker running?): %v", wiremockErr)
	}
	return wiremockURL
}

type webhookCall struct {
	token string
	body  map[string]any
}

// webhookReceiver is the billing-service as far as WireMock can tell: it takes the callbacks of the PSP.
type webhookReceiver struct {
	url   string
	calls chan webhookCall
}

func newWebhookReceiver(t *testing.T) *webhookReceiver {
	t.Helper()
	receiver := &webhookReceiver{calls: make(chan webhookCall, 4)}
	// The container reaches the host through the gateway address, so the listener cannot be loopback only.
	listener, err := net.Listen("tcp", "0.0.0.0:0")
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		receiver.calls <- webhookCall{token: r.Header.Get("X-PSP-Token"), body: body}
		w.WriteHeader(http.StatusNoContent)
	}))
	_ = server.Listener.Close()
	server.Listener = listener
	server.Start()
	t.Cleanup(server.Close)
	receiver.url = fmt.Sprintf("http://host.docker.internal:%d/webhooks/psp", listener.Addr().(*net.TCPAddr).Port)
	return receiver
}

func (r *webhookReceiver) next(t *testing.T) webhookCall {
	t.Helper()
	select {
	case call := <-r.calls:
		return call
	case <-time.After(30 * time.Second):
		t.Fatal("the PSP did not call the webhook within 30s: the container cannot reach the test, or the mapping has no webhook")
		return webhookCall{}
	}
}

func decimal(t *testing.T, value string) model.Money {
	t.Helper()
	amount, err := model.ParseMoney(value)
	if err != nil {
		t.Fatal(err)
	}
	return amount
}

func discardLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

// PAY-12: from R$ 100.000,00 the simulated PSP refuses for lack of funds, below that it approves,
// and both outcomes arrive by webhook and by query.
func TestWireMockApprovesBelowTheLimitAndRefusesFromIt(t *testing.T) {
	baseURL := wiremock(t)
	tests := []struct {
		name       string
		amount     string
		wantPrefix string
		wantState  out.ChargeState
		wantReason string
	}{
		{"one iPhone", "15000.00", "ch_paid_", out.ChargePaid, ""},
		{"a cent below the limit", "99999.99", "ch_paid_", out.ChargePaid, ""},
		{"exactly the limit", "100000.00", "ch_failed_", out.ChargeFailed, "INSUFFICIENT_FUNDS"},
		{"seven iPhones", "105000.00", "ch_failed_", out.ChargeFailed, "INSUFFICIENT_FUNDS"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			receiver := newWebhookReceiver(t)
			client := psp.NewClient(psp.DefaultConfig(baseURL, receiver.url), discardLogger())
			ctx := context.Background()
			invoiceID := uuid.NewString()

			created, err := client.CreateCharge(ctx, out.ChargeRequest{InvoiceID: invoiceID, Amount: decimal(t, tt.amount), Description: "Pedido (AMAZON)"})
			if err != nil {
				t.Fatalf("CreateCharge() error = %v", err)
			}
			if created.ID != tt.wantPrefix+invoiceID {
				t.Fatalf("charge id = %q, want %s%s", created.ID, tt.wantPrefix, invoiceID)
			}

			call := receiver.next(t)
			if call.token != webhookToken {
				t.Errorf("webhook token = %q, want %q", call.token, webhookToken)
			}
			wantReason := any(nil)
			if tt.wantReason != "" {
				wantReason = tt.wantReason
			}
			if call.body["chargeId"] != created.ID || call.body["reference"] != invoiceID || call.body["status"] != string(tt.wantState) || call.body["failureReason"] != wantReason {
				t.Errorf("webhook body = %v, want charge %s of invoice %s with status %s and reason %v", call.body, created.ID, invoiceID, tt.wantState, wantReason)
			}
			if occurredAt, _ := call.body["occurredAt"].(string); occurredAt == "" {
				t.Errorf("webhook body = %v, want occurredAt", call.body)
			} else if _, err := time.Parse(time.RFC3339, occurredAt); err != nil {
				t.Errorf("occurredAt = %q, want an RFC 3339 time: %v", occurredAt, err)
			}

			status, err := client.GetCharge(ctx, created.ID)
			if err != nil || status.State != tt.wantState || status.FailureReason != tt.wantReason {
				t.Errorf("GetCharge() = (%+v, %v), want state %s and reason %q", status, err, tt.wantState, tt.wantReason)
			}
		})
	}
}

func TestWireMockDoesNotKnowOtherCharges(t *testing.T) {
	client := psp.NewClient(psp.DefaultConfig(wiremock(t), "http://unused"), discardLogger())

	for _, id := range []string{"ch_unknown", "ch_paid_not-an-invoice", uuid.NewString()} {
		if _, err := client.GetCharge(context.Background(), id); !errors.Is(err, out.ErrChargeNotFound) {
			t.Errorf("GetCharge(%q) error = %v, want ErrChargeNotFound", id, err)
		}
	}
}

// The outage scenario of the demo: the PSP answers 503, the circuit opens, and billing carries on when it is back.
func TestWireMockOutageScenarioOpensTheCircuitAndRecovers(t *testing.T) {
	baseURL := wiremock(t)
	scenario, err := os.ReadFile(outageFile)
	if err != nil {
		t.Fatal(err)
	}
	var stub struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(scenario, &stub); err != nil || stub.ID == "" {
		t.Fatalf("the outage scenario has no id: %v", err)
	}
	adminCall(t, http.MethodPost, baseURL+"/__admin/mappings", scenario, http.StatusCreated)
	outage := true
	removeOutage := func() {
		if outage {
			adminCall(t, http.MethodDelete, baseURL+"/__admin/mappings/"+stub.ID, nil, http.StatusOK)
			outage = false
		}
	}
	t.Cleanup(removeOutage)

	config := psp.DefaultConfig(baseURL, "http://unused")
	config.BreakerOpenFor = time.Second
	client := psp.NewClient(config, discardLogger())
	request := out.ChargeRequest{InvoiceID: uuid.NewString(), Amount: decimal(t, "15000.00"), Description: "Pedido (AMAZON)"}
	ctx := context.Background()

	if _, err := client.CreateCharge(ctx, request); !errors.Is(err, out.ErrUnavailable) {
		t.Fatalf("first call during the outage: error = %v, want ErrUnavailable", err)
	}
	if _, err := client.CreateCharge(ctx, request); err == nil || !strings.Contains(err.Error(), "circuit is open") {
		t.Fatalf("second call during the outage: error = %v, want the circuit to be open", err)
	}

	removeOutage()
	time.Sleep(1200 * time.Millisecond)
	if _, err := client.CreateCharge(ctx, request); err != nil {
		t.Fatalf("after the outage: error = %v, want the charge to go through", err)
	}
}

func adminCall(t *testing.T, method, url string, body []byte, wantStatus int) {
	t.Helper()
	request, err := http.NewRequestWithContext(context.Background(), method, url, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != wantStatus {
		answer, _ := io.ReadAll(response.Body)
		t.Fatalf("%s %s = %d %s, want %d", method, url, response.StatusCode, answer, wantStatus)
	}
}
