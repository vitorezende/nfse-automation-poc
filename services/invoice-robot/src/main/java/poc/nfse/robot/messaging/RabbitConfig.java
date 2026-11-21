package poc.nfse.robot.messaging;

import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import org.springframework.amqp.rabbit.core.RabbitAdmin;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.amqp.rabbit.retry.MessageRecoverer;
import org.springframework.amqp.rabbit.retry.RepublishMessageRecoverer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Topology itself is declared by infrastructure (infra/rabbitmq/definitions.json); the robot only uses it. */
@Configuration
public class RabbitConfig {

  @Bean
  RabbitAdmin rabbitAdmin(ConnectionFactory connectionFactory) {
    return new RabbitAdmin(connectionFactory);
  }

  /**
   * Last resort for unexpected listener errors (e.g. no broker confirm), after the in-process retries with
   * backoff configured in application.yml: park the command in the DLQ rather than requeue it in a tight
   * loop or drop it. Page failures never get here; RetryScheduler handles them.
   */
  @Bean
  MessageRecoverer parkInDeadLetterQueue(RabbitTemplate rabbitTemplate) {
    return new RepublishMessageRecoverer(rabbitTemplate, "", RetryScheduler.DLQ);
  }
}
