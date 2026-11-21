package poc.nfse.robot.issuance;

import java.util.Map;

/** How one attempt ended. Issued and business failures are final; transient failures are retried. */
public sealed interface IssuanceOutcome {

  record Issued(IssuedNfse nfse) implements IssuanceOutcome {}

  record BusinessFailure(String reason) implements IssuanceOutcome {}

  /** @param artifacts references to the screenshot and trace of the failed attempt (possibly empty) */
  record TransientFailure(String reason, Map<String, Object> artifacts) implements IssuanceOutcome {}
}
