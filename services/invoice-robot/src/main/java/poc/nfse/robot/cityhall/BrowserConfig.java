package poc.nfse.robot.cityhall;

import com.microsoft.playwright.Browser;
import com.microsoft.playwright.BrowserType;
import com.microsoft.playwright.Playwright;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import poc.nfse.robot.RobotProperties;

/** One browser per robot instance; each Solicitação gets its own isolated BrowserContext. */
@Configuration
public class BrowserConfig {

  @Bean(destroyMethod = "close")
  Playwright playwright() {
    return Playwright.create();
  }

  @Bean(destroyMethod = "close")
  Browser browser(Playwright playwright, RobotProperties properties) {
    return playwright.chromium().launch(new BrowserType.LaunchOptions().setHeadless(properties.headless()));
  }
}
