package poc.nfse.robot.messaging;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.amqp.AmqpRejectAndDontRequeueException;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;
import poc.nfse.robot.issuance.IssuanceOutcome;
import poc.nfse.robot.issuance.IssuanceService;
import poc.nfse.robot.issuance.IssueNfseCommand;

/**
 * Consumes IssueNfse commands. The listener returns (and the message is acked) only after the outcome
 * event has been confirmed by the broker.
 */
@Component
public class IssueNfseListener {

  private static final Logger log = LoggerFactory.getLogger(IssueNfseListener.class);

  private final ContractValidator contracts;
  private final ObjectMapper json;
  private final IssuanceService issuance;
  private final RetryScheduler retries;

  public IssueNfseListener(ContractValidator contracts, ObjectMapper json, IssuanceService issuance, RetryScheduler retries) {
    this.contracts = contracts;
    this.json = json;
    this.issuance = issuance;
    this.retries = retries;
  }

  @RabbitListener(queues = "robot.issue-nfse")
  public void onIssueNfse(Message message) {
    JsonNode body = parse(message);
    MDC.put("correlationId", body.path("correlationId").asText("-"));
    try {
      List<String> violations = contracts.validate(body);
      if (!violations.isEmpty()) {
        log.warn("Rejecting message {} that breaks the IssueNfse contract: {}", body.path("messageId").asText(), violations);
        throw new AmqpRejectAndDontRequeueException("Contract violation");
      }
      IssueNfseCommand command = json.treeToValue(body, IssueNfseCommand.class);
      int attempt = attemptOf(message);
      log.info("Issuing NFS-e for Solicitação {} (RPS {}/{}), attempt {}", command.payload().issuanceRequestId(),
          command.payload().rps().number(), command.payload().rps().series(), attempt);
      if (issuance.attempt(command, attempt) instanceof IssuanceOutcome.TransientFailure failure) {
        retries.onTransientFailure(message, command, attempt, failure.reason(), failure.artifacts());
      }
    } catch (IOException e) {
      throw new AmqpRejectAndDontRequeueException("Unreadable IssueNfse", e);
    } finally {
      MDC.remove("correlationId");
    }
  }

  private static int attemptOf(Message message) {
    Object header = message.getMessageProperties().getHeader(RetryScheduler.ATTEMPT_HEADER);
    return header instanceof Number n ? n.intValue() : 1;
  }

  private JsonNode parse(Message message) {
    try {
      return json.readTree(message.getBody());
    } catch (IOException e) {
      throw new AmqpRejectAndDontRequeueException("Message is not JSON", e);
    }
  }
}
