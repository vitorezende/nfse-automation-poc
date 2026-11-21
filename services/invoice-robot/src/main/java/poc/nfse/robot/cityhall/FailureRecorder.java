package poc.nfse.robot.cityhall;

import com.microsoft.playwright.BrowserContext;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.Tracing;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import poc.nfse.robot.storage.DocumentStore;

/**
 * Records what the browser saw during an attempt: a Playwright trace runs for the whole BrowserContext and,
 * if the attempt fails, the trace and a screenshot of the page are uploaded to object storage so an operator
 * can inspect them from the Portal da Contabilidade. Recording is best effort: a failure here must never
 * change the outcome of the attempt.
 */
@Component
public class FailureRecorder {

  private static final Logger log = LoggerFactory.getLogger(FailureRecorder.class);

  private final DocumentStore store;

  public FailureRecorder(DocumentStore store) {
    this.store = store;
  }

  public void start(BrowserContext context) {
    try {
      context.tracing().start(new Tracing.StartOptions().setScreenshots(true).setSnapshots(true));
    } catch (RuntimeException e) {
      log.warn("Could not start the Playwright trace: {}", e.getMessage());
    }
  }

  /** The attempt succeeded: stop tracing and keep nothing. */
  public void discard(BrowserContext context) {
    try {
      context.tracing().stop();
    } catch (RuntimeException e) {
      log.debug("Could not stop the Playwright trace", e);
    }
  }

  /**
   * The attempt failed: uploads the screenshot and the trace under {@code keyPrefix} and returns the
   * references that were stored (none, one or both), shaped as the events' failureArtifacts.
   */
  public Map<String, Object> capture(Page page, BrowserContext context, String keyPrefix) {
    Map<String, Object> artifacts = new LinkedHashMap<>();
    try {
      byte[] screenshot = page.screenshot(new Page.ScreenshotOptions().setFullPage(true));
      artifacts.put("screenshot", store.put(keyPrefix + "screenshot.png", screenshot, "image/png"));
    } catch (RuntimeException e) {
      log.warn("Could not store the failure screenshot: {}", e.getMessage());
    }
    Path trace = null;
    try {
      trace = Files.createTempFile("trace-", ".zip");
      context.tracing().stop(new Tracing.StopOptions().setPath(trace));
      artifacts.put("trace", store.put(keyPrefix + "trace.zip", Files.readAllBytes(trace), "application/zip"));
    } catch (IOException | RuntimeException e) {
      log.warn("Could not store the Playwright trace: {}", e.getMessage());
    } finally {
      if (trace != null) {
        try {
          Files.deleteIfExists(trace);
        } catch (IOException e) {
          log.debug("Could not delete {}", trace, e);
        }
      }
    }
    return artifacts;
  }
}
