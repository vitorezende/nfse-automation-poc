package poc.nfse.robot.storage;

import java.net.URI;
import java.util.Map;
import org.springframework.stereotype.Component;
import poc.nfse.robot.RobotProperties;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.checksums.RequestChecksumCalculation;
import software.amazon.awssdk.core.checksums.ResponseChecksumValidation;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;

/** Stores NFS-e documents in S3-compatible object storage; events carry only the references (ADR 0004). */
@Component
public class DocumentStore implements AutoCloseable {

  private final S3Client s3;
  private final String bucket;

  public DocumentStore(RobotProperties properties) {
    RobotProperties.Storage storage = properties.storage();
    this.bucket = storage.bucket();
    this.s3 = S3Client.builder()
        .endpointOverride(URI.create(storage.endpoint()))
        .region(Region.of(storage.region()))
        .forcePathStyle(true)
        // Plain uploads: S3-compatible stores (SeaweedFS here) may persist aws-chunked framing verbatim
        // when the SDK's default flexible checksums are on.
        .requestChecksumCalculation(RequestChecksumCalculation.WHEN_REQUIRED)
        .responseChecksumValidation(ResponseChecksumValidation.WHEN_REQUIRED)
        .serviceConfiguration(S3Configuration.builder().chunkedEncodingEnabled(false).build())
        .credentialsProvider(StaticCredentialsProvider.create(
            AwsBasicCredentials.create(storage.accessKey(), storage.secretKey())))
        .build();
  }

  /** Uploads the object (overwriting it on a retry) and returns its reference as carried in events. */
  public Map<String, String> put(String key, byte[] content, String contentType) {
    s3.putObject(b -> b.bucket(bucket).key(key).contentType(contentType), RequestBody.fromBytes(content));
    return Map.of("bucket", bucket, "key", key);
  }

  @Override
  public void close() {
    s3.close();
  }
}
