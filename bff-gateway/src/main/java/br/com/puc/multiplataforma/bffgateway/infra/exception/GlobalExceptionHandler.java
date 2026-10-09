package br.com.puc.multiplataforma.bffgateway.infra.exception;

import br.com.puc.multiplataforma.bffgateway.core.catalog.exception.InvalidCatalogException;
import io.micrometer.tracing.Span;
import io.micrometer.tracing.Tracer;
import org.jspecify.annotations.NonNull;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authorization.AuthorizationDeniedException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

@RestControllerAdvice
public class GlobalExceptionHandler extends ResponseEntityExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    private final Tracer tracer;

    public GlobalExceptionHandler(Tracer tracer) {
        this.tracer = tracer;
    }

    @ExceptionHandler(InvalidCatalogException.class)
    public ResponseEntity<Object> handleInvalidCatalog(InvalidCatalogException exception, WebRequest request) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "Invalid catalog spreadsheet");
        problem.setProperty("errors", exception.getErrors());
        return this.handleExceptionInternal(exception, problem, new HttpHeaders(), HttpStatus.BAD_REQUEST, request);
    }

    @ExceptionHandler(AuthorizationDeniedException.class)
    public ResponseEntity<Object> handleAuthorizationDenied(AuthorizationDeniedException exception, WebRequest request) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.FORBIDDEN, "Access denied");
        return this.handleExceptionInternal(exception, problem, new HttpHeaders(), HttpStatus.FORBIDDEN, request);
    }

    @Override
    protected ResponseEntity<Object> handleExceptionInternal(
            @NonNull Exception exception, @Nullable Object body, @NonNull HttpHeaders headers, @NonNull HttpStatusCode statusCode, @NonNull WebRequest request) {
        markCurrentSpanAsError(exception);
        Span span = startExceptionSpan(exception, statusCode, request);
        try (var _ = tracer.withSpan(span)) {
            log.error("Request {} failed with status {}", request.getDescription(true), statusCode.value(), exception);
            return super.handleExceptionInternal(exception, body, headers, statusCode, request);
        } finally {
            span.end();
        }
    }

    private void markCurrentSpanAsError(Exception exception) {
        Span currentSpan = tracer.currentSpan();
        if (currentSpan != null) {
            currentSpan.error(exception);
        }
    }

    private Span startExceptionSpan(Exception exception, HttpStatusCode statusCode, WebRequest request) {
        return tracer.nextSpan()
                .name("exception-handler")
                .tag("exception.type", exception.getClass().getName())
                .tag("http.response.status_code", String.valueOf(statusCode.value()))
                .tag("request", request.getDescription(true))
                .error(exception)
                .start();
    }

}
