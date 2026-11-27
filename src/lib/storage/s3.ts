import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Panel yüklemeleri (kart görselleri, profil fotoğrafları) için özel S3 bucket.
 * Env: S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY.
 * Bucket tanımlı değilse çağıranlar yerel diske düşer (geliştirme).
 */

/** Presigned GET süresi (sn). */
export const S3_SIGNED_URL_TTL = 600;

let client: S3Client | null = null;

function bucket(): string | null {
  return process.env.S3_BUCKET?.trim() || null;
}

export function s3Enabled(): boolean {
  return bucket() != null;
}

function s3(): S3Client {
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
  client ??= new S3Client({
    region: process.env.S3_REGION?.trim() || "eu-north-1",
    // SDK varsayılanı imzalı PUT URL'ine boş gövdenin CRC32'sini gömer →
    // tarayıcıdan yüklenen dosya S3'te "checksum uyuşmadı" ile reddedilir.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    // Anahtar yoksa SDK’nın varsayılan zinciri (IAM rolü vb.) kullanılır.
    ...(accessKeyId && secretAccessKey
      ? { credentials: { accessKeyId, secretAccessKey } }
      : {}),
  });
  return client;
}

export async function s3Put(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await s3().send(
    new PutObjectCommand({
      Bucket: bucket()!,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "private, max-age=31536000, immutable",
    }),
  );
}

export async function s3Delete(key: string): Promise<void> {
  await s3().send(new DeleteObjectCommand({ Bucket: bucket()!, Key: key }));
}

/** Nesneyi okur; yoksa null. */
export async function s3Get(key: string): Promise<Buffer | null> {
  try {
    const res = await s3().send(
      new GetObjectCommand({ Bucket: bucket()!, Key: key }),
    );
    if (!res.Body) return null;
    return Buffer.from(await res.Body.transformToByteArray());
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === "NoSuchKey" || name === "NotFound") return null;
    // ListBucket izni yoksa S3 eksik anahtar için 403 döner.
    const status = (err as { $metadata?: { httpStatusCode?: number } })
      .$metadata?.httpStatusCode;
    if (status === 403 || status === 404) return null;
    throw err;
  }
}

/** Nesnenin [start, end] (dahil) bayt aralığı — büyük videoları parça parça okumak için. */
export async function s3GetRange(key: string, start: number, end: number): Promise<Buffer> {
  const res = await s3().send(
    new GetObjectCommand({ Bucket: bucket()!, Key: key, Range: `bytes=${start}-${end}` }),
  );
  if (!res.Body) throw new Error("S3 boş yanıt");
  return Buffer.from(await res.Body.transformToByteArray());
}

export async function s3SignedGetUrl(
  key: string,
  expiresIn: number = S3_SIGNED_URL_TTL,
): Promise<string> {
  return getSignedUrl(
    s3(),
    new GetObjectCommand({ Bucket: bucket()!, Key: key }),
    { expiresIn },
  );
}

/**
 * Tarayıcıdan doğrudan bucket'a yükleme (büyük videolar sunucudan geçmez).
 * Bucket CORS'unda panel origin'i için PUT izni gerekir.
 */
export async function s3SignedPutUrl(
  key: string,
  contentType: string,
  expiresIn = 3600,
): Promise<string> {
  return getSignedUrl(
    s3(),
    new PutObjectCommand({
      Bucket: bucket()!,
      Key: key,
      ContentType: contentType,
      CacheControl: "private, max-age=31536000, immutable",
    }),
    { expiresIn },
  );
}

/** Nesne boyutu / türü; yoksa null. */
export async function s3Head(
  key: string,
): Promise<{ size: number; contentType: string | null } | null> {
  try {
    const res = await s3().send(
      new HeadObjectCommand({ Bucket: bucket()!, Key: key }),
    );
    return { size: Number(res.ContentLength ?? 0), contentType: res.ContentType ?? null };
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } })
      .$metadata?.httpStatusCode;
    if (status === 403 || status === 404) return null;
    throw err;
  }
}
