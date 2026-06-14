import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@clipal/config';
import { bucket, s3 } from './client';

/** Body shapes we accept for an upload (matches the SDK's stream/buffer union). */
export type PutBody = Uint8Array | Buffer | string | Readable;

/**
 * Upload (create or overwrite) an object. `contentType` is stored as the
 * object's Content-Type so the public URL serves with correct headers.
 */
export async function putObject(
  key: string,
  body: PutBody,
  contentType: string,
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

/**
 * Fetch an object's bytes. Returns `null` when the key does not exist rather
 * than throwing, so callers can treat a cache miss as a normal control path.
 */
export async function getObject(key: string): Promise<Buffer | null> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!res.Body) return null;
    const bytes = await res.Body.transformToByteArray();
    return Buffer.from(bytes);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/** Delete an object. Succeeds (idempotently) even if the key is absent. */
export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/** True iff an object exists at `key` (a HEAD probe; no body transfer). */
export async function objectExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

/**
 * Build the public, unsigned URL for `key` from `S3_PUBLIC_URL`. Pure
 * string-building — does NOT verify the object exists. Each path segment is
 * URL-encoded; the leading slash on `key` (if any) is ignored.
 */
export function publicUrl(key: string): string {
  const base = env.S3_PUBLIC_URL.replace(/\/+$/, '');
  const path = key
    .replace(/^\/+/, '')
    .split('/')
    .map(encodeURIComponent)
    .join('/');
  return `${base}/${path}`;
}

/**
 * A short-lived, signed GET URL for `key`. Use for private objects that should
 * not be served via the public bucket URL. `ttlSec` is the expiry in seconds.
 */
export function presignGet(key: string, ttlSec: number): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: ttlSec,
  });
}

/**
 * Normalise the several ways the S3 SDK signals a missing object (typed
 * NoSuchKey/NotFound errors, a bare `name`, or a 404 status) into one boolean.
 */
function isNotFound(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const name = 'name' in err ? err.name : undefined;
  if (name === 'NoSuchKey' || name === 'NotFound') return true;
  const meta = (err as { $metadata?: { httpStatusCode?: number } }).$metadata;
  return meta?.httpStatusCode === 404;
}
