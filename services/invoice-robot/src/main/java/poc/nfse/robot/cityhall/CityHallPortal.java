package poc.nfse.robot.cityhall;

import com.microsoft.playwright.APIResponse;
import com.microsoft.playwright.Locator;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.Response;
import com.microsoft.playwright.options.AriaRole;
import java.math.RoundingMode;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Optional;
import poc.nfse.robot.credentials.CredentialStore.Credentials;
import poc.nfse.robot.issuance.BusinessFailureException;
import poc.nfse.robot.issuance.IssueNfseCommand;
import poc.nfse.robot.issuance.IssuedNfse;
import poc.nfse.robot.issuance.NfseDocuments;
import poc.nfse.robot.issuance.SessionExpiredException;
import poc.nfse.robot.issuance.TransientFailureException;

/**
 * Page operations on the Portal da Prefeitura, driven the way a person would: by visible labels and texts.
 * One instance wraps one page of one Solicitação's BrowserContext.
 */
public class CityHallPortal {

  private static final DateTimeFormatter ISSUED_AT = DateTimeFormatter.ofPattern("dd/MM/yyyy, HH:mm:ss");
  private static final ZoneId CITY_HALL_ZONE = ZoneId.of("America/Sao_Paulo");

  private final Page page;
  private final String baseUrl;

  public CityHallPortal(Page page, String baseUrl) {
    this.page = page;
    this.baseUrl = baseUrl;
  }

  public void login(Credentials credentials) {
    open("/login");
    page.getByLabel("Usuário", new Page.GetByLabelOptions().setExact(true)).fill(credentials.username());
    page.getByLabel("Senha", new Page.GetByLabelOptions().setExact(true)).fill(credentials.password());
    solveCaptchaIfAsked();
    submit("Entrar");
    // Wait for an outcome, not a load state: either the logged-in menu or a refusal.
    Locator loggedIn = page.getByRole(AriaRole.BUTTON, new Page.GetByRoleOptions().setName("Sair"));
    Locator error = page.getByRole(AriaRole.ALERT);
    loggedIn.or(error).first().waitFor();
    if (error.isVisible()) throw new BusinessFailureException("Login refused by the Prefeitura: " + error.innerText());
  }

  /** The NFS-e already issued for this RPS, if any: the Prefeitura's own idempotency check (ADR 0002). */
  public Optional<IssuedNfse> findByRps(IssueNfseCommand.Rps rps) {
    open("/nfse/consulta?rpsNumber=" + rps.number() + "&rpsSeries=" + URLEncoder.encode(rps.series(), StandardCharsets.UTF_8));
    Locator result = page.locator("#resultado");
    Locator notFound = result.getByText("Nenhuma NFS-e encontrada");
    Locator found = result.getByRole(AriaRole.LINK).first();
    notFound.or(found).first().waitFor();
    if (notFound.isVisible()) return Optional.empty();
    checkStatus(page.waitForResponse(response -> response.request().isNavigationRequest(), found::click), "NFS-e detail");
    return Optional.of(readDetail());
  }

  public IssuedNfse issue(IssueNfseCommand.Payload payload) {
    open("/nfse/emitir");
    fill("Número do RPS", String.valueOf(payload.rps().number()));
    fill("Série do RPS", payload.rps().series());
    fill("CNPJ do tomador", payload.tomador().cnpj());
    fill("Razão social do tomador", payload.tomador().name());
    fill("Código do serviço", payload.servico().code());
    fill("Descrição do serviço", payload.servico().description());
    fill("Alíquota do ISS (%)", payload.servico().issRate().movePointRight(2).setScale(2, RoundingMode.HALF_UP).toPlainString());
    fill("Valor do serviço (R$)", payload.amount());
    fill("Competência", payload.competencia());
    fill("Discriminação do serviço", payload.discriminacao());
    submit("Emitir NFS-e");

    Locator issued = page.locator("#nfse-number");
    Locator error = page.getByRole(AriaRole.ALERT);
    issued.or(error).first().waitFor();
    if (error.isVisible()) throw new BusinessFailureException("NFS-e refused by the Prefeitura: " + error.innerText());
    return readDetail();
  }

  /**
   * Downloads the XML and the DANFSe PDF linked from the NFS-e detail page (where findByRps and issue leave
   * the page), through the same logged-in session.
   */
  public NfseDocuments downloadDocuments() {
    return new NfseDocuments(download("xml"), download("pdf"));
  }

  private byte[] download(String kind) {
    String href = page.locator("[data-download=\"" + kind + "\"]").getAttribute("href");
    if (href == null) throw new IllegalStateException("No " + kind + " download link on the NFS-e detail page");
    APIResponse response = page.context().request().get(baseUrl + href);
    if (response.status() >= 500) throw new TransientFailureException("Prefeitura answered HTTP " + response.status() + " downloading " + kind);
    if (!response.ok()) throw new IllegalStateException("Could not download " + kind + ": HTTP " + response.status());
    return response.body();
  }

  /**
   * The login captcha is a plain arithmetic challenge ("3 + 4"). This is deliberately not captcha breaking:
   * the fake Prefeitura's captcha is meant to be machine-solvable by a known rule.
   */
  private void solveCaptchaIfAsked() {
    Locator question = page.locator("[data-captcha-question]");
    if (question.count() == 0) return;
    String[] terms = question.getAttribute("data-captcha-question").split("\\+");
    int answer = Integer.parseInt(terms[0].trim()) + Integer.parseInt(terms[1].trim());
    page.locator("#captcha").fill(String.valueOf(answer));
  }

  /** Navigates and checks where we landed: server errors, maintenance and a lost session are all transient. */
  private void open(String path) {
    checkStatus(page.navigate(baseUrl + path), path);
    checkLanding(path);
  }

  /**
   * Content-based checks, because the status code alone lies: a maintenance page is served with HTTP 200,
   * and an expired session is a redirect to the login page.
   */
  private void checkLanding(String step) {
    if (page.locator("[data-maintenance]").count() > 0) {
      throw new TransientFailureException("Prefeitura under scheduled maintenance (at " + step + ")");
    }
    boolean onLogin = page.url().contains("/login");
    if (onLogin && !step.equals("/login") && !step.equals("Entrar")) {
      throw new SessionExpiredException("Prefeitura session expired (at " + step + ")");
    }
  }

  /** Clicks a submit button and checks the HTTP status of the page it leads to. */
  private void submit(String buttonName) {
    Locator button = page.getByRole(AriaRole.BUTTON, new Page.GetByRoleOptions().setName(buttonName));
    Response response = page.waitForResponse(r -> r.request().isNavigationRequest() && "POST".equals(r.request().method()), button::click);
    checkStatus(response, buttonName);
    page.waitForLoadState();
    checkLanding(buttonName);
  }

  private static void checkStatus(Response response, String step) {
    if (response != null && response.status() >= 500) {
      throw new TransientFailureException("Prefeitura answered HTTP " + response.status() + " at " + step);
    }
  }

  private void fill(String label, String value) {
    page.getByLabel(label, new Page.GetByLabelOptions().setExact(true)).fill(value);
  }

  private IssuedNfse readDetail() {
    String number = field("number");
    String verificationCode = field("verificationCode");
    LocalDateTime issuedAt = LocalDateTime.parse(field("issuedAt"), ISSUED_AT);
    return new IssuedNfse(number, verificationCode, issuedAt.atZone(CITY_HALL_ZONE).toInstant());
  }

  private String field(String name) {
    return page.locator("[data-field=\"" + name + "\"]").innerText().trim();
  }
}
