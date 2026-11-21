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

@SpringBootTest
class BrowserFailuresTest extends RobotBoundaryTestSupport {

  @Autowired RabbitTemplate rabbit;
  @Autowired RabbitAdmin admin;

  private String eventsQueue;

  @BeforeEach
  void bindEventsQueue() {
    eventsQueue = "test.events." + UUID.randomUUID();
    admin.declareQueue(new Queue(eventsQueue, false, false, false));
    admin.declareBinding(BindingBuilder.bind(new Queue(eventsQueue)).to(new TopicExchange(EVENTS_EXCHANGE)).with("#"));
    admin.purgeQueue("robot.issue-nfse.dlq");
  }

  @AfterEach
  void cleanUp() throws Exception {
    resetChaos();
    admin.deleteQueue(eventsQueue);
  }

  @Test
  void logsInAgainWhenTheSessionExpiresMidFlow() throws Exception {
    setChaos("sessionExpiryPercent=100");
    ObjectNode command = issueNfseCommand();
    send(rabbit, command);

    List<JsonNode> events = EventCollector.collect(rabbit, eventsQueue, 2, Duration.ofSeconds(60));
    assertThat(types(events)).containsExactly("NfseIssuanceStarted", "NfseIssued");
    assertThat(cityHallHasNfseForRps("acme", "acme-pass", command.at("/payload/rps/number").asInt(), "A")).isTrue();
  }

  @Test
  void treatsAMaintenancePageServedWithHttp200AsTransient() throws Exception {
    setChaos("maintenance=on");
    ObjectNode command = issueNfseCommand();
    send(rabbit, command);

    List<JsonNode> firstAttempt = EventCollector.collect(rabbit, eventsQueue, 2, Duration.ofSeconds(60));
    assertThat(types(firstAttempt)).containsExactly("NfseIssuanceStarted", "NfseIssuanceAttemptFailed");
    assertThat(firstAttempt.get(1).at("/payload/errorCategory").asText()).isEqualTo("transient");
    assertThat(firstAttempt.get(1).at("/payload/reason").asText()).containsIgnoringCase("maintenance");

    resetChaos();
    List<JsonNode> retry = EventCollector.collect(rabbit, eventsQueue, 2, Duration.ofSeconds(60));
    assertThat(types(retry)).containsExactly("NfseIssuanceStarted", "NfseIssued");
  }

  @Test
  void solvesTheLoginCaptcha() throws Exception {
    setChaos("captcha=on");
    send(rabbit, issueNfseCommand());

    List<JsonNode> events = EventCollector.collect(rabbit, eventsQueue, 2, Duration.ofSeconds(60));
    assertThat(types(events)).containsExactly("NfseIssuanceStarted", "NfseIssued");
  }

  @Test
  void failsForGoodWithoutRetriesOnInvalidCredentials() throws Exception {
    ObjectNode command = issueNfseCommand();
    ((ObjectNode) command.at("/payload/prestador")).put("credentialRef", "prestador-acme-wrong-password");
    send(rabbit, command);

    List<JsonNode> events = EventCollector.collect(rabbit, eventsQueue, 3, Duration.ofSeconds(15));
    assertThat(types(events)).containsExactly("NfseIssuanceStarted", "NfseIssuanceFailed");
    assertThat(events.get(1).at("/payload/errorCategory").asText()).isEqualTo("business");
    assertThat(events.get(1).at("/payload/attempt").asInt()).isEqualTo(1);
    assertThat(rabbit.receive("robot.issue-nfse.dlq", 1_000)).isNull();
  }

  private static List<String> types(List<JsonNode> events) {
    return events.stream().map(e -> e.get("type").asText()).toList();
  }
}
