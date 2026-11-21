package poc.nfse.robot;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.io.InputStream;
import java.net.CookieManager;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageBuilder;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.Network;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.containers.RabbitMQContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.images.builder.ImageFromDockerfile;
import org.testcontainers.utility.MountableFile;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;

/**
 * Seam 1: the Robô de Emissão's boundary. Commands go in on the real queue; events, stored objects and
 * the NFS-e at a real Portal da Prefeitura (built from its Dockerfile) are observed from outside.
 */
public abstract class RobotBoundaryTestSupport {

  static final Path REPO_ROOT = Path.of("../..").toAbsolutePath().normalize();
  static final String EVENTS_EXCHANGE = "nfse.events";
  static final String COMMAND_QUEUE = "robot.issue-nfse";
  static final ObjectMapper JSON = new ObjectMapper();
  private static final AtomicInteger NEXT_RPS = new AtomicInteger((int) (Instant.now().getEpochSecond() % 100_000) * 10);

  static final Network NETWORK = Network.newNetwork();

  static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:17-alpine")
      .withNetwork(NETWORK)
      .withNetworkAliases("postgres")
      .withDatabaseName("city_hall");

  static final GenericContainer<?> CITY_HALL = new GenericContainer<>(
          new ImageFromDockerfile("nfse-poc-city-hall-portal-test", false)
              .withFileFromPath(".", REPO_ROOT.resolve("services/city-hall-portal")))
      .withNetwork(NETWORK)
      .withEnv("DATABASE_URL", "postgresql://test:test@postgres:5432/city_hall")
      .withExposedPorts(3001)
      .dependsOn(POSTGRES)
      .waitingFor(Wait.forHttp("/login").forPort(3001).withStartupTimeout(Duration.ofMinutes(3)));

  static final RabbitMQContainer RABBIT = new RabbitMQContainer("rabbitmq:4.1-management-alpine")
      .withCopyFileToContainer(
          MountableFile.forHostPath(REPO_ROOT.resolve("infra/rabbitmq/definitions.json")), "/etc/rabbitmq/definitions.json")
      .withCopyFileToContainer(
          MountableFile.forHostPath(REPO_ROOT.resolve("infra/rabbitmq/10-definitions.conf")),
          "/etc/rabbitmq/conf.d/10-definitions.conf");

  static final String BUCKET = "nfse-documents";

  static final GenericContainer<?> OBJECT_STORAGE = new GenericContainer<>("chrislusf/seaweedfs:3.97")
      .withCommand("server", "-dir=/data", "-s3", "-s3.port=8333", "-s3.config=/etc/seaweedfs/s3.json")
      .withCopyFileToContainer(
          MountableFile.forHostPath(REPO_ROOT.resolve("infra/object-storage/s3.json")), "/etc/seaweedfs/s3.json")
      .withExposedPorts(8333)
      .waitingFor(Wait.forHttp("/healthz").forPort(8333).withStartupTimeout(Duration.ofMinutes(2)));

  static {
    POSTGRES.start();
    CITY_HALL.start();
    RABBIT.start();
    OBJECT_STORAGE.start();
    try (S3Client s3 = s3()) {
      s3.createBucket(b -> b.bucket(BUCKET));
    }
  }

  static String objectStorageUrl() {
    return "http://" + OBJECT_STORAGE.getHost() + ":" + OBJECT_STORAGE.getMappedPort(8333);
  }

  static S3Client s3() {
    return S3Client.builder()
        .endpointOverride(URI.create(objectStorageUrl()))
        .region(Region.US_EAST_1)
        .forcePathStyle(true)
        .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create("poc-access-key", "poc-secret-key")))
        .build();
  }

  static byte[] storedObject(JsonNode ref) {
    try (S3Client s3 = s3()) {
      return s3.getObjectAsBytes(b -> b.bucket(ref.get("bucket").asText()).key(ref.get("key").asText())).asByteArray();
    }
  }

  @DynamicPropertySource
  static void properties(DynamicPropertyRegistry registry) {
    registry.add("spring.rabbitmq.host", RABBIT::getHost);
    registry.add("spring.rabbitmq.port", RABBIT::getAmqpPort);
    registry.add("spring.rabbitmq.username", () -> "poc");
    registry.add("spring.rabbitmq.password", () -> "poc");
    registry.add("robot.city-hall-url", RobotBoundaryTestSupport::cityHallUrl);
    registry.add("robot.credentials-file",
        () -> Path.of("src/test/resources/test-credentials.json").toAbsolutePath().toString());
    // Short backoff so retry scenarios finish quickly; the production default is 10s, 1m, 5m.
    registry.add("robot.retry-delays", () -> "1s,1s,1s");
    registry.add("robot.storage.endpoint", RobotBoundaryTestSupport::objectStorageUrl);
    registry.add("robot.storage.bucket", () -> BUCKET);
    registry.add("robot.storage.access-key", () -> "poc-access-key");
    registry.add("robot.storage.secret-key", () -> "poc-secret-key");
  }

  static String cityHallUrl() {
    return "http://" + CITY_HALL.getHost() + ":" + CITY_HALL.getMappedPort(3001);
  }

  /** The IssueNfse example from the contracts, with fresh identifiers and a never-used RPS number. */
  static ObjectNode issueNfseCommand() throws IOException {
    try (InputStream in = RobotBoundaryTestSupport.class.getResourceAsStream("/contracts/examples/issue-nfse.json")) {
      ObjectNode command = (ObjectNode) JSON.readTree(in);
      command.put("messageId", UUID.randomUUID().toString());
      command.put("correlationId", UUID.randomUUID().toString());
      ObjectNode payload = (ObjectNode) command.get("payload");
      payload.put("issuanceRequestId", UUID.randomUUID().toString());
      ((ObjectNode) payload.get("rps")).put("number", NEXT_RPS.incrementAndGet());
      return command;
    }
  }

  static void send(RabbitTemplate rabbit, JsonNode command) throws IOException {
    Message message = MessageBuilder.withBody(JSON.writeValueAsBytes(command))
        .setContentType(MessageProperties.CONTENT_TYPE_JSON)
        .setMessageId(command.path("messageId").asText())
        .build();
    rabbit.send("", COMMAND_QUEUE, message);
  }

  /** Configures the Portal da Prefeitura's chaos page, as the demo presenter would. */
  static void setChaos(String formFields) throws Exception {
    HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create(cityHallUrl() + "/admin/chaos"))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .POST(HttpRequest.BodyPublishers.ofString(formFields)).build(), HttpResponse.BodyHandlers.discarding());
  }

  static void resetChaos() throws Exception {
    setChaos("latencyMinMs=0&latencyMaxMs=0&submitErrorPercent=0&sessionExpiryPercent=0");
  }

  /** Looks the RPS up on the Portal da Prefeitura as the given Prestador, like a human would. */
  static boolean cityHallHasNfseForRps(String username, String password, int rpsNumber, String rpsSeries) throws Exception {
    HttpClient http = HttpClient.newBuilder().cookieHandler(new CookieManager()).build();
    String form = "username=" + username + "&password=" + URLEncoder.encode(password, StandardCharsets.UTF_8);
    http.send(HttpRequest.newBuilder(URI.create(cityHallUrl() + "/login"))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .POST(HttpRequest.BodyPublishers.ofString(form)).build(), HttpResponse.BodyHandlers.discarding());
    String page = http.send(HttpRequest.newBuilder(URI.create(
            cityHallUrl() + "/nfse/consulta?rpsNumber=" + rpsNumber + "&rpsSeries=" + rpsSeries)).build(),
        HttpResponse.BodyHandlers.ofString()).body();
    if (!page.contains("Consulta de NFS-e por RPS")) throw new IllegalStateException("Login at the Prefeitura failed");
    return !page.contains("Nenhuma NFS-e encontrada");
  }
}
