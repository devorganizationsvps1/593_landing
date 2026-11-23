/**
 * Otomatik paylaşım medyası — depolama anahtarı `social/<postId>/<dosya>`.
 *
 * S3 varsa tarayıcı imzalı PUT ile doğrudan bucket'a yükler; platformlar
 * (Meta vb.) dosyayı imzalı GET URL'inden çeker. S3 yoksa (geliştirme) yükleme
 * ve dış erişim HMAC imzalı panel route'larından geçer.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { ContentMedia } from "@prisma/client";
import { rootDomain } from "@/lib/panel/host";
import { s3Delete, s3Enabled, s3Get, s3Head, s3Put, s3SignedGetUrl, s3SignedPutUrl } from "@/lib/storage/s3";
import {
  ACCEPTED_IMAGE_TYPES,
  ACCEPTED_VIDEO_TYPES,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
} from "@/lib/social/formats";

export const SOCIAL_DIR = "social";
const KEY_RE = /^social\/[a-z0-9]+\/[a-z0-9]+\.(jpg|png|webp|mp4|mov)$/;

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

/** S3 yokken (geliştirme) panel üzerinden yükleme sınırı — gövde belleğe alınır. */
export const MAX_LOCAL_UPLOAD_BYTES = 300 * 1024 * 1024;

/** Platformların dosyayı indirmesi için imzalı URL süresi. */
const PUBLIC_URL_TTL = 6 * 3600;

export function isValidMediaKey(key: string, postId: string): boolean {
  return KEY_RE.test(key) && key.startsWith(`${SOCIAL_DIR}/${postId}/`);
}

export function mediaKind(mime: string): "image" | "video" | null {
  if (ACCEPTED_IMAGE_TYPES.includes(mime)) return "image";
  if (ACCEPTED_VIDEO_TYPES.includes(mime)) return "video";
  return null;
}

export function maxBytesFor(kind: "image" | "video"): number {
  return kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
}

function newKey(postId: string, mime: string): string {
  return `${SOCIAL_DIR}/${postId}/${randomBytes(12).toString("hex")}.${EXT[mime]}`;
}

function fsPath(key: string): string {
  return path.join(process.cwd(), "uploads", key);
}

function signingSecret(): string {
  const s = process.env.AUTH_SECRET?.trim();
  if (!s) throw new Error("AUTH_SECRET tanımlı değil");
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", signingSecret()).update(payload).digest("base64url");
}

export function verifySignature(payload: string, sig: string): boolean {
  const a = Buffer.from(sign(payload));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Dışarıdan erişilebilen panel kökü (S3 yokken platformların medyayı çekmesi için). */
export function publicBaseUrl(): string {
  const env = process.env.PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  return env || `https://admin.${rootDomain()}`;
}

/** Yükleme hedefi: S3 imzalı PUT veya yerel imzalı PUT route'u. */
export async function createUploadTarget(opts: {
  postId: string;
  mime: string;
}): Promise<{ key: string; uploadUrl: string; local: boolean }> {
  const key = newKey(opts.postId, opts.mime);
  if (s3Enabled()) {
    return { key, uploadUrl: await s3SignedPutUrl(key, opts.mime), local: false };
  }
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const sig = sign(`put:${key}:${exp}`);
  const q = new URLSearchParams({ key, exp: String(exp), sig });
  return {
    key,
    uploadUrl: `/api/panel/content-posts/${opts.postId}/media/upload?${q}`,
    local: true,
  };
}

export function verifyLocalUpload(key: string, exp: string, sig: string): boolean {
  const n = Number(exp);
  if (!Number.isFinite(n) || n * 1000 < Date.now()) return false;
  return verifySignature(`put:${key}:${exp}`, sig);
}

export async function writeLocalMedia(key: string, body: Buffer): Promise<void> {
  const p = fsPath(key);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, body);
}

/** Yüklenen nesnenin boyutu; yoksa null. */
export async function headMedia(key: string): Promise<number | null> {
  if (s3Enabled()) return (await s3Head(key))?.size ?? null;
  try {
    return (await stat(fsPath(key))).size;
  } catch {
    return null;
  }
}

export async function readMedia(key: string): Promise<Buffer | null> {
  if (s3Enabled()) return s3Get(key);
  try {
    return await readFile(fsPath(key));
  } catch {
    return null;
  }
}

export async function deleteMedia(key: string): Promise<void> {
  if (s3Enabled()) {
    await s3Delete(key);
    return;
  }
  try {
    await unlink(fsPath(key));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

/**
 * Instagram yalnızca JPEG kabul eder: PNG/WebP JPEG'e çevrilir, yeni anahtar
 * döner (eskisi silinir). Boyutlar da buradan okunur.
 */
export async function normalizeImage(
  postId: string,
  key: string,
  mime: string,
): Promise<{ key: string; mime: string; size: number; width: number | null; height: number | null }> {
  const buf = await readMedia(key);
  if (!buf) throw new Error("Yüklenen dosya bulunamadı");
  const img = sharp(buf, { failOn: "error" }).rotate();
  const meta = await img.metadata();
  if (mime === "image/jpeg" && (meta.orientation ?? 1) === 1) {
    return { key, mime, size: buf.length, width: meta.width ?? null, height: meta.height ?? null };
  }
  const out = await img.jpeg({ quality: 92, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  const jpgKey = newKey(postId, "image/jpeg");
  if (s3Enabled()) await s3Put(jpgKey, out.data, "image/jpeg");
  else await writeLocalMedia(jpgKey, out.data);
  await deleteMedia(key);
  return {
    key: jpgKey,
    mime: "image/jpeg",
    size: out.data.length,
    width: out.info.width,
    height: out.info.height,
  };
}

/** Meta / TikTok gibi platformların dosyayı indireceği herkese açık (süreli) URL. */
export async function publicMediaUrl(m: Pick<ContentMedia, "storageKey">): Promise<string> {
  if (s3Enabled()) return s3SignedGetUrl(m.storageKey, PUBLIC_URL_TTL);
  const exp = Math.floor(Date.now() / 1000) + PUBLIC_URL_TTL;
  const sig = sign(`get:${m.storageKey}:${exp}`);
  const q = new URLSearchParams({ key: m.storageKey, exp: String(exp), sig });
  return `${publicBaseUrl()}/api/social/media?${q}`;
}

export function verifyPublicGet(key: string, exp: string, sig: string): boolean {
  const n = Number(exp);
  if (!Number.isFinite(n) || n * 1000 < Date.now()) return false;
  return verifySignature(`get:${key}:${exp}`, sig);
}

/** Panel içi önizleme URL'i (staff oturumu ister). */
export function previewUrl(postId: string, mediaId: string): string {
  return `/api/panel/content-posts/${postId}/media/${mediaId}`;
}

export function isLocalMediaKey(key: string): boolean {
  return KEY_RE.test(key);
}
