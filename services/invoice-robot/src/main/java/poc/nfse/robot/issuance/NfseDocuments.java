package poc.nfse.robot.issuance;

/** The NFS-e XML and DANFSe PDF downloaded from the Portal da Prefeitura. */
public record NfseDocuments(byte[] xml, byte[] pdf) {}
