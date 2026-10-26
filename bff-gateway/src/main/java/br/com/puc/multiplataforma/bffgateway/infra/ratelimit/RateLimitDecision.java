package br.com.puc.multiplataforma.bffgateway.infra.ratelimit;

public record RateLimitDecision(boolean allowed, long retryAfterSeconds) {

    public static RateLimitDecision allow() {
        return new RateLimitDecision(true, 0);
    }

}
