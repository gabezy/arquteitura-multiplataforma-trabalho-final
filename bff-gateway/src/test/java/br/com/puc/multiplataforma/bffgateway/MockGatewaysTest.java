package br.com.puc.multiplataforma.bffgateway;

import org.springframework.boot.micrometer.tracing.test.autoconfigure.AutoConfigureTracing;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@SpringBootTest(properties = {"app.gateways.order=mock", "app.gateways.billing=mock", "app.gateways.marketplace=mock"})
@AutoConfigureMockMvc
@AutoConfigureTracing
public @interface MockGatewaysTest {
}
