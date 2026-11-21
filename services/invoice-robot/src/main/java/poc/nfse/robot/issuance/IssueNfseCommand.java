package poc.nfse.robot.issuance;

import java.math.BigDecimal;

/** The payload of an IssueNfse command, plus the envelope fields the robot needs. */
public record IssueNfseCommand(
    String messageId,
    String correlationId,
    Payload payload) {

  public record Payload(
      String issuanceRequestId,
      Rps rps,
      Prestador prestador,
      Tomador tomador,
      Servico servico,
      String amount,
      String competencia,
      String discriminacao) {}

  public record Rps(int number, String series) {}

  public record Prestador(String cnpj, String credentialRef) {}

  public record Tomador(String cnpj, String name) {}

  public record Servico(String code, String description, BigDecimal issRate) {}
}
