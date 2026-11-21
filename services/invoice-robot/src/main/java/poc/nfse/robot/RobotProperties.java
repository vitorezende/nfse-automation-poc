package poc.nfse.robot;

import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * @param cityHallUrl     base URL of the Portal da Prefeitura
 * @param credentialsFile JSON secret store mapping credentialRef to Prefeitura logins
 * @param headless        run the browser without a window
 * @param navigationTimeout how long a single page interaction may take
 * @param retryDelays       backoff before each retry of a transient failure; its size is the number of retries
 */
@ConfigurationProperties(prefix = "robot")
public record RobotProperties(
    String cityHallUrl, Path credentialsFile, boolean headless, Duration navigationTimeout, List<Duration> retryDelays) {}
