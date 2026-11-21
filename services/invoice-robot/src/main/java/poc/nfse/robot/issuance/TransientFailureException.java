package poc.nfse.robot.issuance;

/** A failure that may go away on its own (server error, slowness, maintenance): worth retrying later. */
public class TransientFailureException extends RuntimeException {

  public TransientFailureException(String message) {
    super(message);
  }
}
