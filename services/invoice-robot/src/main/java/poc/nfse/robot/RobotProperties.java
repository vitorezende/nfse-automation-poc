package poc.nfse.robot;

import java.nio.file.Path;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * @param cityHallUrl     base URL of the Portal da Prefeitura
 * @param credentialsFile JSON secret store mapping credentialRef to Prefeitura logins
 * @param headless        run the browser without a window
 * @param navigationTimeout how long a single page interaction may take
 */
@ConfigurationProperties(prefix = "robot")
public record RobotProperties(String cityHallUrl, Path credentialsFile, boolean headless, Duration navigationTimeout) {}
