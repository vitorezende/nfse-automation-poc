package poc.nfse.robot.issuance;

import com.microsoft.playwright.Browser;
import com.microsoft.playwright.BrowserContext;
import com.microsoft.playwright.Page;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import poc.nfse.robot.RobotProperties;
import poc.nfse.robot.cityhall.CityHallPortal;
import poc.nfse.robot.credentials.CredentialStore;
import poc.nfse.robot.credentials.CredentialStore.Credentials;
import poc.nfse.robot.messaging.EventPublisher;

/** Issues one NFS-e for one IssueNfse command, reporting progress and outcome as events. */
@Service
public class IssuanceService {

  private static final Logger log = LoggerFactory.getLogger(IssuanceService.class);

  private final Browser browser;
  private final CredentialStore credentials;
  private final EventPublisher events;
  private final RobotProperties properties;

  public IssuanceService(Browser browser, CredentialStore credentials, EventPublisher events, RobotProperties properties) {
    this.browser = browser;
    this.credentials = credentials;
    this.events = events;
    this.properties = properties;
  }

  public void issue(IssueNfseCommand command, int attempt) {
    IssueNfseCommand.Payload payload = command.payload();
    events.publish("NfseIssuanceStarted", "nfse.issuance.started", command, Map.of(
        "issuanceRequestId", payload.issuanceRequestId(), "rps", payload.rps(), "attempt", attempt));

    IssuedNfse nfse;
    try {
      nfse = issueOnCityHall(payload);
    } catch (BusinessFailureException e) {
      reportFailure(command, attempt, "business", e);
      return;
    } catch (RuntimeException e) {
      // Retries with backoff and the dead-letter queue arrive in #9; until then fail visibly, never silently.
      reportFailure(command, attempt, "transient", e);
      return;
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
  }

  private IssuedNfse issueOnCityHall(IssueNfseCommand.Payload payload) {
    Credentials login = credentials.resolve(payload.prestador().credentialRef())
        .orElseThrow(() -> new BusinessFailureException("No credentials for " + payload.prestador().credentialRef()));
    try (BrowserContext context = browser.newContext()) {
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

  private void reportFailure(IssueNfseCommand command, int attempt, String category, RuntimeException error) {
    String reason = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
    log.warn("Issuance failed ({}): {}", category, reason);
    events.publish("NfseIssuanceFailed", "nfse.issuance.failed", command, Map.of(
        "issuanceRequestId", command.payload().issuanceRequestId(),
        "rps", command.payload().rps(),
        "attempt", attempt,
        "errorCategory", category,
        "reason", reason.length() > 500 ? reason.substring(0, 500) : reason));
  }
}
