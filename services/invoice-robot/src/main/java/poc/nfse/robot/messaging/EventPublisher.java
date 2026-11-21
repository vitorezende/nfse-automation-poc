package poc.nfse.robot.messaging;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageBuilder;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Component;
import poc.nfse.robot.issuance.IssueNfseCommand;

/**
 * Publishes NFS-e events on the topic exchange and blocks until the broker confirms each one, so the
 * command is acknowledged only after its outcome is safely in RabbitMQ.
 */
@Component
public class EventPublisher {

  public static final String EVENTS_EXCHANGE = "nfse.events";
  private static final long CONFIRM_TIMEOUT_SECONDS = 10;
  private static final Logger log = LoggerFactory.getLogger(EventPublisher.class);

  private final RabbitTemplate rabbit;
  private final ObjectMapper json;
  private final ContractValidator contracts;

  public EventPublisher(RabbitTemplate rabbit, ObjectMapper json, ContractValidator contracts) {
    this.rabbit = rabbit;
    this.json = json;
    this.contracts = contracts;
  }

  /** Wraps the payload in the standard envelope, caused by the given command. */
  public void publish(String type, String routingKey, IssueNfseCommand cause, Object payload) {
    ObjectNode event = json.createObjectNode();
    event.put("messageId", UUID.randomUUID().toString());
    event.put("correlationId", cause.correlationId());
    event.put("causationId", cause.messageId());
    event.put("type", type);
    event.put("version", 1);
    event.put("occurredAt", Instant.now().toString());
    event.set("payload", json.valueToTree(payload));

    List<String> violations = contracts.validate(event);
    if (!violations.isEmpty()) throw new IllegalStateException("Outgoing " + type + " breaks its contract: " + violations);

    String messageId = event.get("messageId").asText();
    Message message = MessageBuilder.withBody(serialize(event))
        .setContentType(MessageProperties.CONTENT_TYPE_JSON)
        .setMessageId(messageId)
        .setCorrelationId(cause.correlationId())
        .setType(type)
        .build();
    CorrelationData confirm = new CorrelationData(messageId);
    rabbit.send(EVENTS_EXCHANGE, routingKey, message, confirm);
    try {
      CorrelationData.Confirm result = confirm.getFuture().get(CONFIRM_TIMEOUT_SECONDS, TimeUnit.SECONDS);
      if (!result.isAck()) throw new IllegalStateException("Broker nacked " + type + ": " + result.getReason());
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException("Interrupted while waiting for the confirm of " + type, e);
    } catch (Exception e) {
      if (e instanceof IllegalStateException ise) throw ise;
      throw new IllegalStateException("No broker confirm for " + type, e);
    }
    log.info("Published {} {}", type, messageId);
  }

  /** @param artifacts screenshot/trace references of the failed attempt; omitted from the event when empty */
  public void publishFailure(String type, IssueNfseCommand cause, int attempt, String category, String reason,
      Map<String, Object> artifacts) {
    String routingKey = "NfseIssuanceFailed".equals(type) ? "nfse.issuance.failed" : "nfse.issuance.attempt-failed";
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("issuanceRequestId", cause.payload().issuanceRequestId());
    payload.put("rps", cause.payload().rps());
    payload.put("attempt", attempt);
    payload.put("errorCategory", category);
    payload.put("reason", reason == null || reason.isBlank() ? "unknown" : reason);
    if (!artifacts.isEmpty()) payload.put("artifacts", artifacts);
    publish(type, routingKey, cause, payload);
  }

  private byte[] serialize(ObjectNode event) {
    try {
      return json.writeValueAsBytes(event);
    } catch (JsonProcessingException e) {
      throw new IllegalStateException(e);
    }
  }
}
