package br.com.puc.multiplataforma.bffgateway.core.shared.exception;

public class DownstreamFailureException extends RuntimeException {

    private final String service;

    public DownstreamFailureException(String service, String reason, Throwable cause) {
        super("%s returned an unexpected response: %s".formatted(service, reason), cause);
        this.service = service;
    }

    public String getService() {
        return service;
    }

}
