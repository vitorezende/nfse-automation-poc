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
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.TopicExchange;
import org.springframework.amqp.rabbit.core.RabbitAdmin;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import poc.nfse.robot.messaging.ContractValidator;

@SpringBootTest
class ChaosRetryTest extends RobotBoundaryTestSupport {

  static final String DLQ = "robot.issue-nfse.dlq";

  @Autowired RabbitTemplate rabbit;
  @Autowired RabbitAdmin admin;
  @Autowired ContractValidator contracts;

  private String eventsQueue;

  @BeforeEach
  void bindEventsQueue() {
    eventsQueue = "test.events." + UUID.randomUUID();
    admin.declareQueue(new Queue(eventsQueue, false, false, false));
    admin.declareBinding(BindingBuilder.bind(new Queue(eventsQueue)).to(new TopicExchange(EVENTS_EXCHANGE)).with("#"));
    admin.purgeQueue(DLQ);
  }

  @AfterEach
  void cleanUp() throws Exception {
    resetChaos();
    admin.deleteQueue(eventsQueue);
  }

  @Test
  void recoversFromIntermittentServerErrors() throws Exception {
    setChaos("latencyMinMs=0&latencyMaxMs=0&submitErrorPercent=100");
    ObjectNode command = issueNfseCommand();
    send(rabbit, command);

    List<JsonNode> firstAttempt = EventCollector.collect(rabbit, eventsQueue, 2, Duration.ofSeconds(60));
    assertThat(types(firstAttempt)).containsExactly("NfseIssuanceStarted", "NfseIssuanceAttemptFailed");
    JsonNode attemptFailed = firstAttempt.get(1);
    assertThat(contracts.validate(attemptFailed)).isEmpty();
    assertThat(attemptFailed.at("/payload/attempt").asInt()).isEqualTo(1);
    assertThat(attemptFailed.at("/payload/errorCategory").asText()).isEqualTo("transient");

    resetChaos(); // the Prefeitura recovers before the retry fires
    List<JsonNode> retry = EventCollector.collect(rabbit, eventsQueue, 2, Duration.ofSeconds(60));
    assertThat(types(retry)).containsExactly("NfseIssuanceStarted", "NfseIssued");
    assertThat(retry.get(1).at("/payload/attempt").asInt()).isEqualTo(2);
    assertThat(cityHallHasNfseForRps("acme", "acme-pass", command.at("/payload/rps/number").asInt(), "A")).isTrue();
  }

  @Test
  void stillIssuesWhenThePrefeituraIsSlow() throws Exception {
    setChaos("latencyMinMs=1500&latencyMaxMs=2500&submitErrorPercent=0");
    send(rabbit, issueNfseCommand());

    List<JsonNode> events = EventCollector.collect(rabbit, eventsQueue, 2, Duration.ofSeconds(90));
    assertThat(types(events)).containsExactly("NfseIssuanceStarted", "NfseIssued");
  }

  @Test
  void parksTheCommandInTheDlqAndReportsFailureWhenRetriesAreExhausted() throws Exception {
    setChaos("latencyMinMs=0&latencyMaxMs=0&submitErrorPercent=100");
    ObjectNode command = issueNfseCommand();
    send(rabbit, command);

    // 1 attempt + 3 retries, each Started + AttemptFailed, then the final failure.
    List<JsonNode> events = EventCollector.collect(rabbit, eventsQueue, 9, Duration.ofSeconds(120));
    assertThat(types(events)).containsExactly(
        "NfseIssuanceStarted", "NfseIssuanceAttemptFailed",
        "NfseIssuanceStarted", "NfseIssuanceAttemptFailed",
        "NfseIssuanceStarted", "NfseIssuanceAttemptFailed",
        "NfseIssuanceStarted", "NfseIssuanceAttemptFailed",
        "NfseIssuanceFailed");
    JsonNode failed = events.get(8);
    assertThat(contracts.validate(failed)).isEmpty();
    assertThat(failed.at("/payload/attempt").asInt()).isEqualTo(4);
    assertThat(failed.at("/payload/errorCategory").asText()).isEqualTo("transient");

    Message parked = rabbit.receive(DLQ, 5_000);
    assertThat(parked).isNotNull();
    assertThat(JSON.readTree(parked.getBody()).get("messageId")).isEqualTo(command.get("messageId"));
  }

  private static List<String> types(List<JsonNode> events) {
    return events.stream().map(e -> e.get("type").asText()).toList();
  }
}
