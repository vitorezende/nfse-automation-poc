package poc.nfse.robot.cityhall;

import com.microsoft.playwright.Browser;
import com.microsoft.playwright.BrowserType;
import com.microsoft.playwright.Playwright;
import jakarta.annotation.PreDestroy;
import java.util.Queue;
import java.util.concurrent.ConcurrentLinkedQueue;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import poc.nfse.robot.RobotProperties;

/**
 * One Playwright + Browser per consumer thread. Playwright for Java is not thread-safe: every object must be
 * used on the thread that created it, so threads cannot share a Browser. Each Solicitação still gets its own
 * isolated BrowserContext (cookies, session) on top of its thread's Browser.
 */
@Component
public class BrowserPool {

  private static final Logger log = LoggerFactory.getLogger(BrowserPool.class);

  private final RobotProperties properties;
  private final ThreadLocal<Browser> browsers = new ThreadLocal<>();
  private final Queue<Playwright> created = new ConcurrentLinkedQueue<>();

  public BrowserPool(RobotProperties properties) {
    this.properties = properties;
  }

  /** The calling thread's browser, launched on first use. */
  public Browser browser() {
    Browser browser = browsers.get();
    if (browser == null || !browser.isConnected()) {
      Playwright playwright = Playwright.create();
      created.add(playwright);
      browser = playwright.chromium().launch(new BrowserType.LaunchOptions().setHeadless(properties.headless()));
      browsers.set(browser);
      log.info("Launched browser for thread {}", Thread.currentThread().getName());
    }
    return browser;
  }

  @PreDestroy
  void closeAll() {
    created.forEach(playwright -> {
      try {
        playwright.close();
      } catch (RuntimeException e) {
        log.debug("Ignoring error while closing Playwright", e);
      }
    });
  }
}
