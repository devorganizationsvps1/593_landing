/**
 * Sunucu yönetimi — Dokploy kurulumları (env).
 *
 *   DOKPLOY_URL / DOKPLOY_API_KEY / DOKPLOY_NAME          → 1. kurulum
 *   DOKPLOY_2_URL / DOKPLOY_2_API_KEY / DOKPLOY_2_NAME    → 2. kurulum (… 5'e kadar)
 *
 * Her kurulum kendi makinesini ("host") ve ona bağlı uzak sunucuları getirir;
 * yani tek Dokploy iki VPS'i yönetiyorsa tek anahtar, her VPS'te ayrı Dokploy
 * varsa iki anahtar yeterlidir. API anahtarı: Dokploy → Settings → Profile.
 *
 *   DOKPLOY_MOCK=1            → gerçek API yerine örnek veri (yerel geliştirme)
 *   SERVER_MONITOR_LOCAL=1:host → panelin çalıştığı sunucuyu elle belirler
 *                                 ("none" = kapat). Verilmezse panelin kendi
 *                                 domainini taşıyan Dokploy servisinden bulunur;
 *                                 o sunucunun ölçümü ajan olmadan Node'dan alınır.
 *   SERVER_MONITOR_DISABLED=true → zamanlayıcıyı kapatır
 */

export type DokployInstance = {
  id: string;
  label: string;
  /** Sonunda / olmadan, ör. https://dokploy.example.com */
  url: string;
  apiKey: string;
};

const MAX_INSTANCES = 5;

export function dokployMock(): boolean {
  return process.env.DOKPLOY_MOCK === "1";
}

export function dokployInstances(): DokployInstance[] {
  if (dokployMock()) {
    return [
      { id: "1", label: "VPS 1", url: "https://dokploy-1.example.com", apiKey: "mock" },
      { id: "2", label: "VPS 2", url: "https://dokploy-2.example.com", apiKey: "mock" },
    ];
  }
  const out: DokployInstance[] = [];
  for (let i = 1; i <= MAX_INSTANCES; i++) {
    const prefix = i === 1 ? "DOKPLOY" : `DOKPLOY_${i}`;
    const url = process.env[`${prefix}_URL`]?.trim().replace(/\/+$/, "").replace(/\/api$/, "");
    const apiKey = process.env[`${prefix}_API_KEY`]?.trim();
    if (!url || !apiKey) continue;
    out.push({
      id: String(i),
      label: process.env[`${prefix}_NAME`]?.trim() || `Sunucu ${i}`,
      url,
      apiKey,
    });
  }
  return out;
}

export function serverKey(instanceId: string, serverId: string | null): string {
  return `${instanceId}:${serverId ?? "host"}`;
}

/** Elle belirlenmiş "panelin çalıştığı sunucu"; "none" otomatik bulmayı kapatır. */
export function localServerOverride(): string | null {
  return process.env.SERVER_MONITOR_LOCAL?.trim() || null;
}

/** Uyarı eşikleri. */
export const DISK_WARN_PCT = 85;
export const DISK_CRITICAL_PCT = 93;
export const SSL_WARN_DAYS = 14;
export const SAMPLE_RETENTION_DAYS = 30;
export const CHECK_RETENTION_DAYS = 14;
