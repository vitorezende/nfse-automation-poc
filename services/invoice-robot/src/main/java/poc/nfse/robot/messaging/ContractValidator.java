package poc.nfse.robot.messaging;

import com.fasterxml.jackson.databind.JsonNode;
import com.networknt.schema.JsonSchema;
import com.networknt.schema.JsonSchemaFactory;
import com.networknt.schema.SchemaLocation;
import com.networknt.schema.SchemaValidatorsConfig;
import com.networknt.schema.SpecVersion.VersionFlag;
import com.networknt.schema.ValidationMessage;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/** Validates messages against the shared JSON Schemas in contracts/ (bundled on the classpath). */
@Component
public class ContractValidator {

  private static final String SCHEMA_BASE = "https://nfse-poc.example/schemas/";
  private static final Map<String, String> SCHEMA_BY_TYPE = Map.of(
      "IssueNfse", "issue-nfse.schema.json",
      "NfseIssuanceStarted", "nfse-issuance-started.schema.json",
      "NfseIssuanceAttemptFailed", "nfse-issuance-attempt-failed.schema.json",
      "NfseIssued", "nfse-issued.schema.json",
      "NfseIssuanceFailed", "nfse-issuance-failed.schema.json");

  private final JsonSchemaFactory factory = JsonSchemaFactory.getInstance(VersionFlag.V202012,
      builder -> builder.schemaMappers(mappers -> mappers.mapPrefix(SCHEMA_BASE, "classpath:contracts/schemas/")));
  private final SchemaValidatorsConfig config = SchemaValidatorsConfig.builder().formatAssertionsEnabled(true).build();
  private final Map<String, JsonSchema> schemas = new ConcurrentHashMap<>();

  /** Returns the violations; empty when the message honours its contract. */
  public List<String> validate(JsonNode message) {
    String schemaFile = SCHEMA_BY_TYPE.get(message.path("type").asText());
    if (schemaFile == null) return List.of("unknown message type: " + message.path("type").asText());
    JsonSchema schema = schemas.computeIfAbsent(schemaFile,
        file -> factory.getSchema(SchemaLocation.of(SCHEMA_BASE + file), config));
    return schema.validate(message).stream().map(ValidationMessage::getMessage).toList();
  }
}
