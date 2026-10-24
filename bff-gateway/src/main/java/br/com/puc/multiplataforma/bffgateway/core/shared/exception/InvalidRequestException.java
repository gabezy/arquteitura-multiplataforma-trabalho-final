package br.com.puc.multiplataforma.bffgateway.core.shared.exception;

public class InvalidRequestException extends RuntimeException {

    public InvalidRequestException(String message) {
        super(message);
    }

}
