package poc.nfse.robot;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Duration;
import java.util.ArrayList;
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
class ConcurrencyTest extends RobotBoundaryTestSupport {

  record Prestador(String cnpj, String credentialRef, String username, String password) {}

  static final List<Prestador> PRESTADORES = List.of(
      new Prestador("11.111.111/0001-11", "prestador-acme", "acme", "acme-pass"),
      new Prestador("22.333.444/0001-55", "prestador-beta", "beta", "beta-pass"),
      new Prestador("33.444.555/0001-66", "prestador-gama", "gama", "gama-pass"));

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
  void deleteEventsQueue() {
    admin.deleteQueue(eventsQueue);
  }

  @Test
  void issuesConcurrentCommandsForDifferentPrestadoresInIsolatedSessions() throws Exception {
    List<ObjectNode> commands = new ArrayList<>();
    for (int i = 0; i < 6; i++) {
      Prestador prestador = PRESTADORES.get(i % PRESTADORES.size());
      ObjectNode command = issueNfseCommand();
      ObjectNode p = (ObjectNode) command.at("/payload/prestador");
      p.put("cnpj", prestador.cnpj());
      p.put("credentialRef", prestador.credentialRef());
      commands.add(command);
    }
    for (ObjectNode command : commands) send(rabbit, command);

    List<JsonNode> events = EventCollector.collect(rabbit, eventsQueue, 12, Duration.ofSeconds(120));
    List<String> types = events.stream().map(e -> e.get("type").asText()).toList();
    assertThat(types).filteredOn("NfseIssued"::equals).hasSize(6);
    // Several issuances were in flight at once: more than one started before the first finished.
    assertThat(types.subList(0, types.indexOf("NfseIssued"))).filteredOn("NfseIssuanceStarted"::equals).hasSizeGreaterThan(1);

    // Each NFS-e belongs to the right Prestador: sessions never leaked between concurrent issuances.
    for (int i = 0; i < commands.size(); i++) {
      Prestador prestador = PRESTADORES.get(i % PRESTADORES.size());
      int rps = commands.get(i).at("/payload/rps/number").asInt();
      assertThat(cityHallHasNfseForRps(prestador.username(), prestador.password(), rps, "A"))
          .as("RPS %d for %s", rps, prestador.username()).isTrue();
    }
  }
}
