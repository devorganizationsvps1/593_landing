/**
 * OAuth token'larını DB'de şifreli saklamak için AES-256-GCM.
 *
 * Anahtar: SOCIAL_TOKEN_KEY (32 bayt, base64) varsa o; yoksa AUTH_SECRET'tan
 * HKDF ile türetilir. Anahtar değişirse kayıtlı token'lar çözülemez → hesaplar
 * yeniden bağlanmalı.
 *
 * Biçim: `v1.<iv>.<tag>.<şifreli>` (base64url).
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const VERSION = "v1";
let cached: Buffer | null = null;

function key(): Buffer {
  if (cached) return cached;
  const explicit = process.env.SOCIAL_TOKEN_KEY?.trim();
  if (explicit) {
    const k = Buffer.from(explicit, "base64");
    if (k.length !== 32) throw new Error("SOCIAL_TOKEN_KEY 32 baytlık base64 olmalı");
    cached = k;
    return k;
  }
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) throw new Error("AUTH_SECRET tanımlı değil (token şifrelemesi için gerekli)");
  cached = Buffer.from(hkdfSync("sha256", secret, "593-social-tokens", "token-box-v1", 32));
  return cached;
}

export function sealToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), enc.toString("base64url")].join(".");
}

/** Çözülemezse (anahtar değişmiş / bozuk) null. */
export function openToken(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  const [v, iv, tag, enc] = sealed.split(".");
  if (v !== VERSION || !iv || !tag || !enc) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(enc, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
