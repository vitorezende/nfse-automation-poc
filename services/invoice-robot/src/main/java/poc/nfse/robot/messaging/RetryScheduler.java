package poc.nfse.robot.messaging;

import java.time.Duration;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageBuilder;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Component;
import poc.nfse.robot.RobotProperties;
import poc.nfse.robot.issuance.IssueNfseCommand;

/**
 * Decides what happens after a transient failure: republish the command to the delay queue of its retry
 * stage (it returns to robot.issue-nfse when its per-message expiration elapses) or, once retries are
 * exhausted, park it in the DLQ and report the final failure. Every publish is broker-confirmed before the
 * original delivery is acked.
 */
@Component
public class RetryScheduler {

  public static final String ATTEMPT_HEADER = "x-attempt";
  static final String RETRY_QUEUE_PREFIX = "robot.issue-nfse.retry-";
  /** Retry queues declared in infra/rabbitmq/definitions.json; a delay without a queue would be dropped. */
  static final int DECLARED_RETRY_QUEUES = 3;
  static final String DLQ = "robot.issue-nfse.dlq";
  private static final Logger log = LoggerFactory.getLogger(RetryScheduler.class);

  private final RabbitTemplate rabbit;
  private final EventPublisher events;
  private final List<Duration> delays;

  public RetryScheduler(RabbitTemplate rabbit, EventPublisher events, RobotProperties properties) {
    this.rabbit = rabbit;
    this.events = events;
    this.delays = properties.retryDelays();
    if (delays.size() > DECLARED_RETRY_QUEUES) {
      throw new IllegalStateException("robot.retry-delays has " + delays.size() + " entries but only "
          + DECLARED_RETRY_QUEUES + " retry queues are declared");
    }
  }

  public void onTransientFailure(Message original, IssueNfseCommand command, int attempt, String reason) {
    // Events are published only after the republish is confirmed, so a failed send never duplicates them.
    if (attempt <= delays.size()) {
      Duration delay = delays.get(attempt - 1);
      Message retry = MessageBuilder.fromMessage(original)
          .setHeader(ATTEMPT_HEADER, attempt + 1)
          .setExpiration(String.valueOf(delay.toMillis()))
          .build();
      sendConfirmed(RETRY_QUEUE_PREFIX + attempt, retry);
      events.publishFailure("NfseIssuanceAttemptFailed", command, attempt, "transient", reason);
      log.info("Retry {} of {} scheduled in {}", attempt, delays.size(), delay);
    } else {
      Message parked = MessageBuilder.fromMessage(original)
          .setHeader("x-final-attempt", attempt)
          .setHeader("x-failure-reason", reason)
          .build();
      sendConfirmed(DLQ, parked);
      events.publishFailure("NfseIssuanceAttemptFailed", command, attempt, "transient", reason);
      log.warn("Retries exhausted after {} attempts; command parked in {}", attempt, DLQ);
      events.publishFailure("NfseIssuanceFailed", command, attempt, "transient", "Retries exhausted: " + reason);
    }
  }

  private void sendConfirmed(String queue, Message message) {
    CorrelationData confirm = new CorrelationData(message.getMessageProperties().getMessageId() + ":" + queue);
    rabbit.send("", queue, message, confirm);
    try {
      if (!confirm.getFuture().get(10, TimeUnit.SECONDS).isAck()) throw new IllegalStateException("Broker nacked " + queue);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException(e);
    } catch (java.util.concurrent.ExecutionException | java.util.concurrent.TimeoutException e) {
      throw new IllegalStateException("No broker confirm for " + queue, e);
    }
  }
}
