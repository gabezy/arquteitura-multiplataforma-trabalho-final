package br.com.puc.multiplataforma.bffgateway.infra.shared.gateway;

import br.com.puc.multiplataforma.bffgateway.core.shared.exception.DownstreamUnavailableException;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.client.RestClient;

import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class DownstreamClientFactoryTest {

    private final AtomicReference<String> receivedUserId = new AtomicReference<>();
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final DownstreamClientFactory factory =
            new DownstreamClientFactory(RestClient.builder(), Duration.ofSeconds(1), Duration.ofMillis(300));

    private HttpServer server;

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        server.setExecutor(executor);
        server.createContext("/greetings", exchange -> {
            receivedUserId.set(exchange.getRequestHeaders().getFirst("X-User-Id"));
            respond(exchange, "{\"message\":\"hi\"}");
        });
        server.createContext("/slow", exchange -> {
            sleep(Duration.ofSeconds(3));
            respond(exchange, "{\"message\":\"late\"}");
        });
        server.start();
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
        executor.shutdownNow();
        SecurityContextHolder.clearContext();
    }

    @Test
    void callsTheServiceAtTheBaseUrl() {
        DownstreamClient client = factory.create("order-service", baseUrl());

        Greeting greeting = client.get(uri -> uri.path("/greetings").build(), Greeting.class);

        assertThat(greeting.message()).isEqualTo("hi");
    }

    @Test
    void forwardsTheAuthenticatedUserInTheUserIdHeader() {
        authenticateAs("user-123");
        DownstreamClient client = factory.create("order-service", baseUrl());

        client.get(uri -> uri.path("/greetings").build(), Greeting.class);

        assertThat(receivedUserId.get()).isEqualTo("user-123");
    }

    @Test
    void sendsNoUserIdHeaderWithoutAnAuthenticatedUser() {
        DownstreamClient client = factory.create("order-service", baseUrl());

        client.get(uri -> uri.path("/greetings").build(), Greeting.class);

        assertThat(receivedUserId.get()).isNull();
    }

    @Test
    void reportsTheServiceAsUnavailableWhenNothingListensOnThePort() throws IOException {
        DownstreamClient client = factory.create("order-service", "http://127.0.0.1:" + freePort());

        assertThatThrownBy(() -> client.get(uri -> uri.path("/greetings").build(), Greeting.class))
                .isInstanceOf(DownstreamUnavailableException.class)
                .hasMessage("order-service is unavailable");
    }

    @Test
    void reportsTheServiceAsUnavailableWhenItAnswersAfterTheReadTimeout() {
        DownstreamClient client = factory.create("order-service", baseUrl());

        assertThatThrownBy(() -> client.get(uri -> uri.path("/slow").build(), Greeting.class))
                .isInstanceOf(DownstreamUnavailableException.class);
    }

    private String baseUrl() {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    private static int freePort() throws IOException {
        try (ServerSocket socket = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) {
            return socket.getLocalPort();
        }
    }

    private static void respond(HttpExchange exchange, String json) throws IOException {
        byte[] body = json.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(200, body.length);
        exchange.getResponseBody().write(body);
        exchange.close();
    }

    private static void sleep(Duration duration) {
        try {
            Thread.sleep(duration);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private static void authenticateAs(String subject) {
        Jwt jwt = Jwt.withTokenValue("token").header("alg", "none").subject(subject).build();
        SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(jwt));
    }

    record Greeting(String message) {
    }

}
