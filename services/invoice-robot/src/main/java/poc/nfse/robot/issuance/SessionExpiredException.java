package poc.nfse.robot.issuance;

/** The Prefeitura sent us back to its login page mid-flow. Logging in again usually fixes it. */
public class SessionExpiredException extends TransientFailureException {

  public SessionExpiredException(String message) {
    super(message);
  }
}
