package poc.nfse.robot.issuance;

/** The Prefeitura refused the request for a reason retrying cannot fix (bad credentials, rejected data). */
public class BusinessFailureException extends RuntimeException {

  public BusinessFailureException(String message) {
    super(message);
  }
}
