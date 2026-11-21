package poc.nfse.robot;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
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

/** ADR 0002: the RPS lookup before issuing keeps exactly one NFS-e per RPS, whatever the network does. */
@SpringBootTest
class IdempotencyTest extends RobotBoundaryTestSupport {

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
  void aPhantomTimeoutNeverProducesASecondNfse() throws Exception {
    // The Prefeitura issues the NFS-e but never answers the form submission.
    setChaos("phantomTimeoutPercent=100");
    ObjectNode command = issueNfseCommand();
    int rps = command.at("/payload/rps/number").asInt();
    send(rabbit, command);

    List<JsonNode> events = EventCollector.collect(rabbit, eventsQueue, 4, Duration.ofSeconds(90));
    assertThat(types(events)).containsExactly(
        "NfseIssuanceStarted", "NfseIssuanceAttemptFailed", "NfseIssuanceStarted", "NfseIssued");
    assertThat(events.get(3).at("/payload/attempt").asInt()).isEqualTo(2);
    assertThat(cityHallNfseCountForRps("acme", "acme-pass", rps, "A")).isEqualTo(1);
  }

  @Test
  void aRedeliveredCommandReportsTheSameNfseWithoutIssuingAgain() throws Exception {
    ObjectNode command = issueNfseCommand();
    int rps = command.at("/payload/rps/number").asInt();
    send(rabbit, command);
    List<JsonNode> first = EventCollector.collect(rabbit, eventsQueue, 2, Duration.ofSeconds(60));
    assertThat(types(first)).containsExactly("NfseIssuanceStarted", "NfseIssued");

    send(rabbit, command); // same messageId and RPS, as after a crash before the ack
    List<JsonNode> second = EventCollector.collect(rabbit, eventsQueue, 2, Duration.ofSeconds(60));
    assertThat(types(second)).containsExactly("NfseIssuanceStarted", "NfseIssued");
    assertThat(second.get(1).at("/payload/nfse/number")).isEqualTo(first.get(1).at("/payload/nfse/number"));
    assertThat(cityHallNfseCountForRps("acme", "acme-pass", rps, "A")).isEqualTo(1);
  }

  private static List<String> types(List<JsonNode> events) {
    return events.stream().map(e -> e.get("type").asText()).toList();
  }
}
