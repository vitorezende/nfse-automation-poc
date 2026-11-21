package poc.nfse.robot.issuance;

import java.time.Instant;

/** An NFS-e as read back from the Portal da Prefeitura. */
public record IssuedNfse(String number, String verificationCode, Instant issuedAt) {}
