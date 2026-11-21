package poc.nfse.robot.credentials;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.Optional;
import org.springframework.stereotype.Component;
import poc.nfse.robot.RobotProperties;

/** The robot's own secret store: resolves a credentialRef from a command into a Prefeitura login. */
@Component
public class CredentialStore {

  public record Credentials(String username, String password) {}

  private final JsonNode entries;

  public CredentialStore(RobotProperties properties, ObjectMapper json) {
    try {
      this.entries = json.readTree(properties.credentialsFile().toFile());
    } catch (IOException e) {
      throw new UncheckedIOException("Cannot read credential store " + properties.credentialsFile(), e);
    }
  }

  public Optional<Credentials> resolve(String credentialRef) {
    JsonNode entry = entries.get(credentialRef);
    if (entry == null || !entry.has("username")) return Optional.empty();
    return Optional.of(new Credentials(entry.get("username").asText(), entry.get("password").asText()));
  }
}
