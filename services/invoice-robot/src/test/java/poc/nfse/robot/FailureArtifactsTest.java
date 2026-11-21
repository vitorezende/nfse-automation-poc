package poc.nfse.robot;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.ByteArrayInputStream;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.zip.ZipInputStream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.TopicExchange;
import org.springframework.amqp.rabbit.core.RabbitAdmin;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest
class FailureArtifactsTest extends RobotBoundaryTestSupport {

  private static final byte[] PNG_SIGNATURE = {(byte) 0x89, 'P', 'N', 'G'};

  @Autowired RabbitTemplate rabbit;
  @Autowired RabbitAdmin admin;

  private String eventsQueue;

  @BeforeEach
  void bindEventsQueue() {
    eventsQueue = "test.events." + UUID.randomUUID();
    admin.declareQueue(new Queue(eventsQueue, false, false, false));
    admin.declareBinding(BindingBuilder.bind(new Queue(eventsQueue)).to(new TopicExchange(EVENTS_EXCHANGE)).with("#"));
  }

  @AfterEach
  void cleanUp() throws Exception {
    resetChaos();
    admin.deleteQueue(eventsQueue);
  }

  @Test
  void aFailedAttemptStoresAScreenshotAndATraceReferencedByItsEvent() throws Exception {
    setChaos("maintenance=on");
    ObjectNode command = issueNfseCommand();
    send(rabbit, command);

    List<JsonNode> events = EventCollector.collect(rabbit, eventsQueue, 2, Duration.ofSeconds(60));
    resetChaos();
    assertThat(events).extracting(e -> e.get("type").asText()).containsExactly("NfseIssuanceStarted", "NfseIssuanceAttemptFailed");
    JsonNode artifacts = events.get(1).at("/payload/artifacts");
    String issuanceRequestId = command.at("/payload/issuanceRequestId").asText();
    assertThat(artifacts.at("/screenshot/key").asText()).startsWith(issuanceRequestId + "/").contains("attempt-1");
    assertThat(artifacts.at("/trace/key").asText()).startsWith(issuanceRequestId + "/").contains("attempt-1");
    assertIsPng(storedObject(artifacts.get("screenshot")));
    assertIsPlaywrightTrace(storedObject(artifacts.get("trace")));

    // The retry succeeds once the maintenance is over; a success carries no failure artifacts.
    List<JsonNode> retry = EventCollector.collect(rabbit, eventsQueue, 2, Duration.ofSeconds(60));
    assertThat(retry).extracting(e -> e.get("type").asText()).containsExactly("NfseIssuanceStarted", "NfseIssued");
  }

  @Test
  void aBusinessFailureCarriesItsArtifactsToo() throws Exception {
    ObjectNode command = issueNfseCommand();
    ((ObjectNode) command.at("/payload/prestador")).put("credentialRef", "prestador-acme-wrong-password");
    send(rabbit, command);

    List<JsonNode> events = EventCollector.collect(rabbit, eventsQueue, 2, Duration.ofSeconds(30));
    assertThat(events).extracting(e -> e.get("type").asText()).containsExactly("NfseIssuanceStarted", "NfseIssuanceFailed");
    JsonNode artifacts = events.get(1).at("/payload/artifacts");
    assertIsPng(storedObject(artifacts.get("screenshot")));
    assertIsPlaywrightTrace(storedObject(artifacts.get("trace")));
  }

  private static void assertIsPng(byte[] content) {
    assertThat(content).startsWith(PNG_SIGNATURE);
  }

  /** A Playwright trace is a zip holding (at least) the "trace.trace" action log. */
  private static void assertIsPlaywrightTrace(byte[] content) throws Exception {
    boolean hasActionLog = false;
    try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(content))) {
      for (var entry = zip.getNextEntry(); entry != null; entry = zip.getNextEntry()) {
        if (entry.getName().endsWith(".trace")) hasActionLog = true;
      }
    }
    assertThat(hasActionLog).as("trace zip contains a .trace action log").isTrue();
  }
}
