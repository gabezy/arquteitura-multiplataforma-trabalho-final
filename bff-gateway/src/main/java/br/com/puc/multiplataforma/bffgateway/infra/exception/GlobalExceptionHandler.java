package br.com.puc.multiplataforma.bffgateway.infra.exception;

import br.com.puc.multiplataforma.bffgateway.core.catalog.exception.InvalidCatalogException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

@RestControllerAdvice
public class GlobalExceptionHandler extends ResponseEntityExceptionHandler {

    @ExceptionHandler(InvalidCatalogException.class)
    public ResponseEntity<Object> handleInvalidCatalog(InvalidCatalogException exception, WebRequest request) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "Invalid catalog spreadsheet");
        problem.setProperty("errors", exception.getErrors());
        return this.handleExceptionInternal(exception, problem, new HttpHeaders(), HttpStatus.BAD_REQUEST, request);
    }

}
