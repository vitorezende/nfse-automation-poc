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
import poc.nfse.robot.cityhall.FailureRecorder;
import poc.nfse.robot.credentials.CredentialStore;
import poc.nfse.robot.credentials.CredentialStore.Credentials;
import poc.nfse.robot.messaging.EventPublisher;
import poc.nfse.robot.storage.DocumentStore;

/**
 * Runs one attempt at issuing the NFS-e for an IssueNfse command. Publishes NfseIssuanceStarted and, when the
 * attempt ends for good, NfseIssued or NfseIssuanceFailed. Transient failures are returned to the caller, which
 * decides between retrying and giving up.
 */
@Service
public class IssuanceService {

  private static final Logger log = LoggerFactory.getLogger(IssuanceService.class);
  /** Re-logins within one attempt before a lost session counts as a transient failure of the attempt. */
  private static final int MAX_RELOGINS = 2;

  private final BrowserPool browsers;
  private final CredentialStore credentials;
  private final EventPublisher events;
  private final RobotProperties properties;
  private final DocumentStore documents;
  private final FailureRecorder recorder;

  public IssuanceService(BrowserPool browsers, CredentialStore credentials, EventPublisher events,
      RobotProperties properties, DocumentStore documents, FailureRecorder recorder) {
    this.browsers = browsers;
    this.credentials = credentials;
    this.events = events;
    this.properties = properties;
    this.documents = documents;
    this.recorder = recorder;
  }

  private record Result(IssuedNfse nfse, NfseDocuments documents) {}

  /** A failure on the Prefeitura's pages, with the screenshot and trace recorded when it happened. */
  private static final class RecordedFailure extends RuntimeException {
    private final transient Map<String, Object> artifacts;

    RecordedFailure(RuntimeException cause, Map<String, Object> artifacts) {
      super(cause);
      this.artifacts = artifacts;
    }
  }

  public IssuanceOutcome attempt(IssueNfseCommand command, int attempt) {
    IssueNfseCommand.Payload payload = command.payload();
    events.publish("NfseIssuanceStarted", "nfse.issuance.started", command, Map.of(
        "issuanceRequestId", payload.issuanceRequestId(), "rps", payload.rps(), "attempt", attempt));

    IssuedNfse nfse;
    Map<String, Object> documentRefs;
    try {
      Result result = issueOnCityHall(command, attempt);
      nfse = result.nfse();
      // Claim check: documents are stored before NfseIssued is published (ADR 0004).
      String prefix = payload.issuanceRequestId() + "/";
      documentRefs = Map.of(
          "xml", documents.put(prefix + "nfse-" + nfse.number() + ".xml", result.documents().xml(), "application/xml"),
          "pdf", documents.put(prefix + "danfse-" + nfse.number() + ".pdf", result.documents().pdf(), "application/pdf"));
    } catch (RuntimeException e) {
      Throwable failure = e;
      Map<String, Object> artifacts = Map.of();
      if (e instanceof RecordedFailure recorded) {
        failure = recorded.getCause();
        artifacts = recorded.artifacts;
      }
      if (failure instanceof BusinessFailureException) {
        log.warn("Issuance failed for good (business): {}", failure.getMessage());
        events.publishFailure("NfseIssuanceFailed", command, attempt, "business", failure.getMessage(), artifacts);
        return new IssuanceOutcome.BusinessFailure(failure.getMessage());
      }
      // Server errors, timeouts, browser hiccups: anything not known to be final is worth a retry.
      String reason = failure.getMessage() == null ? failure.getClass().getSimpleName() : firstLine(failure.getMessage());
      log.warn("Attempt {} failed (transient): {}", attempt, reason);
      return new IssuanceOutcome.TransientFailure(reason, artifacts);
    }

    log.info("NFS-e {} issued for RPS {}/{}", nfse.number(), payload.rps().number(), payload.rps().series());
    events.publish("NfseIssued", "nfse.issued", command, Map.of(
        "issuanceRequestId", payload.issuanceRequestId(),
        "rps", payload.rps(),
        "attempt", attempt,
        "nfse", Map.of(
            "number", nfse.number(),
            "verificationCode", nfse.verificationCode(),
            "issuedAt", nfse.issuedAt().toString()),
        "documents", documentRefs));
    return new IssuanceOutcome.Issued(nfse);
  }

  private Result issueOnCityHall(IssueNfseCommand command, int attempt) {
    IssueNfseCommand.Payload payload = command.payload();
    Credentials login = credentials.resolve(payload.prestador().credentialRef())
        .orElseThrow(() -> new BusinessFailureException("No credentials for " + payload.prestador().credentialRef()));
    try (BrowserContext context = browsers.browser().newContext()) {
      context.setDefaultTimeout(properties.navigationTimeout().toMillis());
      recorder.start(context);
      Page page = context.newPage();
      try {
        Result result = issueWithRelogins(new CityHallPortal(page, properties.cityHallUrl()), payload, login);
        recorder.discard(context);
        return result;
      } catch (RuntimeException e) {
        // Keyed by command too: a Reprocessamento sends a new command whose attempts start again at 1.
        String keyPrefix = payload.issuanceRequestId() + "/failures/" + command.messageId() + "/attempt-" + attempt + "/";
        throw new RecordedFailure(e, recorder.capture(page, context, keyPrefix));
      }
    }
  }

  private Result issueWithRelogins(CityHallPortal portal, IssueNfseCommand.Payload payload, Credentials login) {
    portal.login(login);
    for (int relogins = 0; ; relogins++) {
      try {
        // Safe to repeat after a re-login: the lookup by RPS finds an NFS-e issued just before the expiry.
        IssuedNfse nfse = portal.findByRps(payload.rps())
            .map(existing -> {
              log.info("NFS-e {} already exists for RPS {}/{}; not issuing again",
                  existing.number(), payload.rps().number(), payload.rps().series());
              return existing;
            })
            .orElseGet(() -> portal.issue(payload));
        return new Result(nfse, portal.downloadDocuments());
      } catch (SessionExpiredException e) {
        if (relogins >= MAX_RELOGINS) throw e;
        log.info("{}; logging in again", e.getMessage());
        portal.login(login);
      }
    }
  }

  private static String firstLine(String message) {
    String line = message.lines().findFirst().orElse(message);
    return line.length() > 500 ? line.substring(0, 500) : line;
  }
}
