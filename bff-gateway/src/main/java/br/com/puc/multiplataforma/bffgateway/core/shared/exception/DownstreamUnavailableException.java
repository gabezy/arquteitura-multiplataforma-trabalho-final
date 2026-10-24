package br.com.puc.multiplataforma.bffgateway.core.shared.exception;

public class DownstreamUnavailableException extends RuntimeException {

    private final String service;

    public DownstreamUnavailableException(String service, Throwable cause) {
        super(service + " is unavailable", cause);
        this.service = service;
    }

    public String getService() {
        return service;
    }

}
