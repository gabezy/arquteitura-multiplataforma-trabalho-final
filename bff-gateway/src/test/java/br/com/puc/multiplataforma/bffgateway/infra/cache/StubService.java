package br.com.puc.multiplataforma.bffgateway.infra.cache;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * A downstream service that answers fixed responses by method and path and counts the calls,
 * so a test can tell whether the BFF answered from the cache.
 */
final class StubService {

    private record Response(int status, String body) {
    }

    private final HttpServer server;
    private final Map<String, Response> responses = new ConcurrentHashMap<>();
    private final Map<String, AtomicInteger> calls = new ConcurrentHashMap<>();

    private StubService(HttpServer server) {
        this.server = server;
    }

    static StubService start() {
        try {
            HttpServer server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
            StubService stub = new StubService(server);
            server.createContext("/", stub::answer);
            server.start();
            return stub;
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    StubService on(String method, String path, int status, String body) {
        responses.put(method + " " + path, new Response(status, body));
        return this;
    }

    int calls(String method, String path) {
        return calls.getOrDefault(method + " " + path, new AtomicInteger()).get();
    }

    void resetCalls() {
        calls.clear();
    }

    String url() {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    void stop() {
        server.stop(0);
    }

    private void answer(HttpExchange exchange) throws IOException {
        String key = exchange.getRequestMethod() + " " + exchange.getRequestURI().getPath();
        calls.computeIfAbsent(key, _ -> new AtomicInteger()).incrementAndGet();
        Response response = responses.getOrDefault(key, new Response(404, "{\"status\":404}"));
        if (response.body().isEmpty()) {
            exchange.sendResponseHeaders(response.status(), -1);
            exchange.close();
            return;
        }
        byte[] bytes = response.body().getBytes(StandardCharsets.UTF_8);
        String contentType = response.status() >= 400 ? "application/problem+json" : "application/json";
        exchange.getResponseHeaders().add("Content-Type", contentType);
        exchange.sendResponseHeaders(response.status(), bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }

}
