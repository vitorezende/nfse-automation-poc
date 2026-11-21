import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';

const LINK_TTL_SECONDS = 15 * 60;

/**
 * Presigned download links for NFS-e documents in object storage (claim check, ADR 0004). Signed for the
 * endpoint the operator's browser can reach, which differs from the in-network one inside compose.
 */
@Injectable()
export class DocumentLinks {
  private readonly s3 = new S3Client({
    endpoint: process.env.S3_PUBLIC_ENDPOINT ?? 'http://localhost:8333',
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: true,
    // No flexible checksums: S3-compatible stores (SeaweedFS here) don't all support them.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? 'poc-access-key',
      secretAccessKey: process.env.S3_SECRET_KEY ?? 'poc-secret-key',
    },
  });

  link(bucket: string, key: string, filename: string): Promise<string> {
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: bucket, Key: key, ResponseContentDisposition: `attachment; filename="${filename}"` }),
      { expiresIn: LINK_TTL_SECONDS },
    );
  }
}
