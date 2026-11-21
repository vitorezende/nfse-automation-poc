package poc.nfse.robot.issuance;

import com.microsoft.playwright.BrowserContext;
import com.microsoft.playwright.Page;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import poc.nfse.robot.RobotProperties;
import poc.nfse.robot.cityhall.BrowserPool;
import poc.nfse.robot.cityhall.CityHallPortal;
import poc.nfse.robot.credentials.CredentialStore;
import poc.nfse.robot.credentials.CredentialStore.Credentials;
import poc.nfse.robot.messaging.EventPublisher;

/**
 * Runs one attempt at issuing the NFS-e for an IssueNfse command. Publishes NfseIssuanceStarted and, when the
 * attempt ends for good, NfseIssued or NfseIssuanceFailed. Transient failures are returned to the caller, which
 * decides between retrying and giving up.
 */
@Service
public class IssuanceService {

  private static final Logger log = LoggerFactory.getLogger(IssuanceService.class);

  private final BrowserPool browsers;
  private final CredentialStore credentials;
  private final EventPublisher events;
  private final RobotProperties properties;

  public IssuanceService(BrowserPool browsers, CredentialStore credentials, EventPublisher events, RobotProperties properties) {
    this.browsers = browsers;
    this.credentials = credentials;
    this.events = events;
    this.properties = properties;
  }

  public IssuanceOutcome attempt(IssueNfseCommand command, int attempt) {
    IssueNfseCommand.Payload payload = command.payload();
    events.publish("NfseIssuanceStarted", "nfse.issuance.started", command, Map.of(
        "issuanceRequestId", payload.issuanceRequestId(), "rps", payload.rps(), "attempt", attempt));

    IssuedNfse nfse;
    try {
      nfse = issueOnCityHall(payload);
    } catch (BusinessFailureException e) {
      log.warn("Issuance failed for good (business): {}", e.getMessage());
      events.publishFailure("NfseIssuanceFailed", command, attempt, "business", e.getMessage());
      return new IssuanceOutcome.BusinessFailure(e.getMessage());
    } catch (RuntimeException e) {
      // Server errors, timeouts, browser hiccups: anything not known to be final is worth a retry.
      String reason = e.getMessage() == null ? e.getClass().getSimpleName() : firstLine(e.getMessage());
      log.warn("Attempt {} failed (transient): {}", attempt, reason);
      return new IssuanceOutcome.TransientFailure(reason);
    }

    log.info("NFS-e {} issued for RPS {}/{}", nfse.number(), payload.rps().number(), payload.rps().series());
    events.publish("NfseIssued", "nfse.issued", command, Map.of(
        "issuanceRequestId", payload.issuanceRequestId(),
        "rps", payload.rps(),
        "attempt", attempt,
        "nfse", Map.of(
            "number", nfse.number(),
            "verificationCode", nfse.verificationCode(),
            "issuedAt", nfse.issuedAt().toString())));
    return new IssuanceOutcome.Issued(nfse);
  }

  private IssuedNfse issueOnCityHall(IssueNfseCommand.Payload payload) {
    Credentials login = credentials.resolve(payload.prestador().credentialRef())
        .orElseThrow(() -> new BusinessFailureException("No credentials for " + payload.prestador().credentialRef()));
    try (BrowserContext context = browsers.browser().newContext()) {
      context.setDefaultTimeout(properties.navigationTimeout().toMillis());
      Page page = context.newPage();
      CityHallPortal portal = new CityHallPortal(page, properties.cityHallUrl());
      portal.login(login);
      return portal.findByRps(payload.rps())
          .map(existing -> {
            log.info("NFS-e {} already exists for RPS {}/{}; not issuing again",
                existing.number(), payload.rps().number(), payload.rps().series());
            return existing;
          })
          .orElseGet(() -> portal.issue(payload));
    }
  }

  private static String firstLine(String message) {
    String line = message.lines().findFirst().orElse(message);
    return line.length() > 500 ? line.substring(0, 500) : line;
  }
}
