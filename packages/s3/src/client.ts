import { S3Client } from '@aws-sdk/client-s3';
import { env } from '@clipal/config';

/**
 * Process-wide singleton S3/MinIO client.
 *
 * `forcePathStyle: true` is REQUIRED for MinIO (and any S3-compatible endpoint
 * that does not support virtual-hosted-style bucket subdomains). Endpoint,
 * region and credentials come from the validated env. Credentials may be empty
 * strings in dev — the AWS SDK only complains when an operation is actually
 * attempted, which keeps module import side-effect-free.
 */
export const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
  },
});

/** The configured bucket all helpers operate against. */
export const bucket = env.S3_BUCKET;
