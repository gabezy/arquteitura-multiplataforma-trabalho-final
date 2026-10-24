// Package httpapi is the HTTP adapter: routes, problem details and the health check.
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"

	"github.com/gabezy/arquteitura-multiplataforma-trabalho-final/billing-service/internal/core/shared/domain"
)

// DefaultHealthTimeout is how long the database has to answer the health check.
const DefaultHealthTimeout = 2 * time.Second

// Deps are the collaborators of the routes.
type Deps struct {
	Logger *slog.Logger
	// CheckHealth reports whether the database answers.
	CheckHealth func(ctx context.Context) error
	// HealthTimeout bounds CheckHealth; zero means DefaultHealthTimeout.
	HealthTimeout time.Duration
	// Invoices are the use cases behind the invoice routes; without them the routes are not registered.
	Invoices InvoiceQueries
}

// Router holds the routes of the service.
type Router struct {
	mux  *http.ServeMux
	deps Deps
}

// handlerFunc is an http.HandlerFunc that reports failure by returning an error,
// which the router turns into a problem details response.
type handlerFunc func(w http.ResponseWriter, r *http.Request) error

// NewRouter registers the routes.
func NewRouter(deps Deps) *Router {
	if deps.HealthTimeout == 0 {
		deps.HealthTimeout = DefaultHealthTimeout
	}
	router := &Router{mux: http.NewServeMux(), deps: deps}
	router.mux.HandleFunc("GET /health", router.health)
	if deps.Invoices != nil {
		router.handle("GET /invoices/{id}", router.getInvoice)
		router.handle("GET /invoices", router.listInvoices)
	}
	return router
}

// Handler returns the router wrapped with tracing and HTTP metrics.
func (r *Router) Handler() http.Handler {
	return otelhttp.NewHandler(r.mux, "billing-service")
}

func (r *Router) handle(pattern string, handler handlerFunc) {
	r.mux.HandleFunc(pattern, func(w http.ResponseWriter, req *http.Request) {
		if err := handler(w, req); err != nil {
			r.writeError(w, req, err)
		}
	})
}

func (r *Router) health(w http.ResponseWriter, req *http.Request) {
	ctx, cancel := context.WithTimeout(req.Context(), r.deps.HealthTimeout)
	defer cancel()

	// The probe runs apart so that one which ignores its context still ends in 503.
	result := make(chan error, 1)
	go func() { result <- r.deps.CheckHealth(ctx) }()

	var err error
	select {
	case err = <-result:
	case <-ctx.Done():
		err = ctx.Err()
	}

	if err != nil {
		r.deps.Logger.WarnContext(req.Context(), "health check failed: database unavailable", "error", err.Error())
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "DOWN"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "UP"})
}

// requestError reports a request the client got wrong, with the offending fields.
type requestError struct {
	Message string
	Issues  []string
}

func (e *requestError) Error() string { return e.Message }

func (r *Router) writeError(w http.ResponseWriter, req *http.Request, err error) {
	var invalidRequest *requestError
	var domainError domain.Error

	switch {
	case errors.As(err, &invalidRequest):
		r.deps.Logger.WarnContext(req.Context(), invalidRequest.Message, "method", req.Method, "path", req.URL.Path)
		writeProblem(w, req, http.StatusBadRequest, invalidRequest.Message, map[string]any{"errors": invalidRequest.Issues})
	case errors.As(err, &domainError):
		r.deps.Logger.WarnContext(req.Context(), err.Error(), "method", req.Method, "path", req.URL.Path)
		writeProblem(w, req, statusOf(domainError), err.Error(), nil)
	default:
		r.deps.Logger.ErrorContext(req.Context(), "unhandled error", "error", err.Error(), "method", req.Method, "path", req.URL.Path)
		writeProblem(w, req, http.StatusInternalServerError, "", nil)
	}
}

func statusOf(err domain.Error) int {
	switch err.(type) {
	case *domain.ValidationError:
		return http.StatusUnprocessableEntity
	case *domain.NotFoundError:
		return http.StatusNotFound
	case *domain.ConflictError:
		return http.StatusConflict
	default:
		return http.StatusInternalServerError
	}
}

func writeProblem(w http.ResponseWriter, req *http.Request, status int, detail string, extensions map[string]any) {
	problem := map[string]any{
		"type":     "about:blank",
		"title":    http.StatusText(status),
		"status":   status,
		"instance": req.URL.RequestURI(),
	}
	if detail != "" {
		problem["detail"] = detail
	}
	for key, value := range extensions {
		problem[key] = value
	}
	writeBody(w, status, "application/problem+json", problem)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	writeBody(w, status, "application/json", body)
}

func writeBody(w http.ResponseWriter, status int, contentType string, body any) {
	w.Header().Set("Content-Type", contentType)
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// NewServer returns an http.Server with the timeouts a public listener needs.
func NewServer(addr string, handler http.Handler) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
}
