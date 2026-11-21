package poc.nfse.robot;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.core.RabbitTemplate;

/** Drains events published by the robot from a test queue bound to the NFS-e events exchange. */
final class EventCollector {

  private EventCollector() {}

  static List<JsonNode> collect(RabbitTemplate rabbit, String queue, int expected, Duration timeout) throws IOException {
    List<JsonNode> events = new ArrayList<>();
    long deadline = System.nanoTime() + timeout.toNanos();
    while (events.size() < expected && System.nanoTime() < deadline) {
      Message message = rabbit.receive(queue, 200);
      if (message != null) events.add(RobotBoundaryTestSupport.JSON.readTree(message.getBody()));
    }
    return events;
  }
}
