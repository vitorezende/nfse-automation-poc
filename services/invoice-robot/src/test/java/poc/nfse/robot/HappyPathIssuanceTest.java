package poc.nfse.robot;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

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
import poc.nfse.robot.messaging.ContractValidator;

@SpringBootTest
class HappyPathIssuanceTest extends RobotBoundaryTestSupport {

  @Autowired RabbitTemplate rabbit;
  @Autowired RabbitAdmin admin;
  @Autowired ContractValidator contracts;

  private String eventsQueue;

  @BeforeEach
  void bindEventsQueue() {
    eventsQueue = "test.events." + UUID.randomUUID();
    admin.declareQueue(new Queue(eventsQueue, false, false, false));
    admin.declareBinding(BindingBuilder.bind(new Queue(eventsQueue)).to(new TopicExchange(EVENTS_EXCHANGE)).with("#"));
  }

  @AfterEach
  void deleteEventsQueue() {
    admin.deleteQueue(eventsQueue);
  }

  @Test
  void issuesTheNfseAndReportsStartedThenIssued() throws Exception {
    ObjectNode command = issueNfseCommand();
    send(rabbit, command);

    List<JsonNode> events = EventCollector.collect(rabbit, eventsQueue, 2, Duration.ofSeconds(60));
    assertThat(events).extracting(e -> e.get("type").asText()).containsExactly("NfseIssuanceStarted", "NfseIssued");
    for (JsonNode event : events) {
      assertThat(contracts.validate(event)).isEmpty();
      assertThat(event.get("correlationId")).isEqualTo(command.get("correlationId"));
      assertThat(event.get("causationId")).isEqualTo(command.get("messageId"));
      assertThat(event.at("/payload/issuanceRequestId")).isEqualTo(command.at("/payload/issuanceRequestId"));
      assertThat(event.at("/payload/rps")).isEqualTo(command.at("/payload/rps"));
    }
    JsonNode nfse = events.get(1).at("/payload/nfse");
    assertThat(nfse.get("number").asText()).matches("\\d{10}");
    assertThat(nfse.get("verificationCode").asText()).matches("[A-Z0-9]{4}-[A-Z0-9]{4}");

    int rpsNumber = command.at("/payload/rps/number").asInt();
    assertThat(cityHallHasNfseForRps("acme", "acme-pass", rpsNumber, "A")).isTrue();

    // Claim check (ADR 0004): the documents are in object storage and the event only references them.
    JsonNode documents = events.get(1).at("/payload/documents");
    String xml = new String(storedObject(documents.get("xml")), java.nio.charset.StandardCharsets.UTF_8);
    assertThat(xml).startsWith("<?xml").contains("<nNFSe>" + nfse.get("number").asText() + "</nNFSe>").contains("SEM VALOR FISCAL");
    byte[] pdf = storedObject(documents.get("pdf"));
    assertThat(new String(pdf, 0, 5, java.nio.charset.StandardCharsets.US_ASCII)).isEqualTo("%PDF-");
  }

  @Test
  void rejectsAMessageThatBreaksTheContractWithoutTouchingThePrefeitura() throws Exception {
    ObjectNode command = issueNfseCommand();
    ((ObjectNode) command.at("/payload/prestador")).put("password", "leaked");
    send(rabbit, command);

    assertThat(EventCollector.collect(rabbit, eventsQueue, 1, Duration.ofSeconds(5))).isEmpty();
    await().atMost(Duration.ofSeconds(10)).until(() -> admin.getQueueInfo(COMMAND_QUEUE).getMessageCount() == 0);
    int rpsNumber = command.at("/payload/rps/number").asInt();
    assertThat(cityHallHasNfseForRps("acme", "acme-pass", rpsNumber, "A")).isFalse();
  }

  @Test
  void reportsABusinessFailureInsteadOfHangingWhenCredentialsAreUnknown() throws Exception {
    ObjectNode command = issueNfseCommand();
    ((ObjectNode) command.at("/payload/prestador")).put("credentialRef", "prestador-unknown");
    send(rabbit, command);

    List<JsonNode> events = EventCollector.collect(rabbit, eventsQueue, 2, Duration.ofSeconds(30));
    assertThat(events).extracting(e -> e.get("type").asText()).containsExactly("NfseIssuanceStarted", "NfseIssuanceFailed");
    JsonNode failed = events.get(1);
    assertThat(contracts.validate(failed)).isEmpty();
    assertThat(failed.at("/payload/errorCategory").asText()).isEqualTo("business");
    assertThat(failed.at("/payload/reason").asText()).contains("prestador-unknown");
  }
}
