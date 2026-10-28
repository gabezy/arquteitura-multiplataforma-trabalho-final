package br.com.puc.multiplataforma.bffgateway.infra.ratelimit;

public interface RateLimiter {

    RateLimitDecision tryAcquire(String userId);

}
