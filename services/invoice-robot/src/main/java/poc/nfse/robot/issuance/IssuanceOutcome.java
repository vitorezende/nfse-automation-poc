package poc.nfse.robot.issuance;

/** How one attempt ended. Issued and business failures are final; transient failures are retried. */
public sealed interface IssuanceOutcome {

  record Issued(IssuedNfse nfse) implements IssuanceOutcome {}

  record BusinessFailure(String reason) implements IssuanceOutcome {}

  record TransientFailure(String reason) implements IssuanceOutcome {}
}
