export type ServiceKind =
  | "application"
  | "compose"
  | "postgres"
  | "mysql"
  | "mariadb"
  | "mongo"
  | "redis"
  | "libsql";

export type DeployInfo = {
  id: string;
  title: string;
  /** running | done | error */
  status: string;
  at: string | null;
  error: string | null;
};

export type DomainInfo = { host: string; https: boolean; path: string };

export type ServiceInfo = {
  id: string;
  kind: ServiceKind;
  name: string;
  appName: string | null;
  /** idle | running | done | error (Dokploy applicationStatus / composeStatus) */
  status: string | null;
  createdAt: string | null;
  serverKey: string;
  /** Detay çağrısı başarısız — sunucu ataması ve tarih bilinmiyor. */
  partial: boolean;
  environment: string | null;
  domains: DomainInfo[];
  deploys: DeployInfo[];
};

export type ProjectInfo = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string | null;
  services: ServiceInfo[];
  /** Marka logosu (sayfa verisinde doldurulur). */
  logo?: string | null;
};

export type ServerInfo = {
  key: string;
  instanceId: string;
  /** null = Dokploy'un kurulu olduğu makine. */
  serverId: string | null;
  name: string;
  ip: string | null;
  /** Dokploy'a eklenme tarihi (host için bilinmez). */
  addedAt: string | null;
  dokployUrl: string;
  dokployVersion: string | null;
  /** Dokploy'un günlük otomatik Docker temizliği. */
  dockerCleanup: boolean | null;
  /** Dokploy metrik ajanı (Monitoring) ayarı; kapalıysa null. */
  metrics: { port: number; token: string } | null;
};

export type Inventory = {
  servers: ServerInfo[];
  /** Tüm kurulumların projeleri; servisler serverKey ile sunucuya bağlanır. */
  projects: ProjectInfo[];
  /** Kurulum bazında erişim hatası (id → mesaj). */
  errors: Record<string, string>;
  fetchedAt: string;
};

export type MetricSnapshot = {
  cpuPct: number | null;
  memPct: number | null;
  memTotalGb: number | null;
  diskPct: number | null;
  diskTotalGb: number | null;
  netInMb: number | null;
  netOutMb: number | null;
  uptimeSec: number | null;
  os: string | null;
  kernel: string | null;
  arch: string | null;
  cpuModel: string | null;
  cpuCores: number | null;
};

export const CLEANUP_ACTIONS = {
  builder: {
    proc: "settings.cleanDockerBuilder",
    label: "Build cache",
    hint: "Docker build önbelleği. Sonraki deploy biraz daha uzun sürer, başka etkisi yok.",
    danger: false,
  },
  images: {
    proc: "settings.cleanUnusedImages",
    label: "Kullanılmayan imajlar",
    hint: "Hiçbir container'ın kullanmadığı eski imajlar. Eski sürüme geri dönüş (rollback) imajları da gider.",
    danger: false,
  },
  containers: {
    proc: "settings.cleanStoppedContainers",
    label: "Durmuş container'lar",
    hint: "Çalışmayan container'lar silinir. Bilerek durdurduğun servisler yeniden deploy gerektirir.",
    danger: false,
  },
  system: {
    proc: "settings.cleanDockerPrune",
    label: "Sistem temizliği",
    hint: "docker system prune + build cache: durmuş container, kullanılmayan ağ ve imajlar birlikte.",
    danger: false,
  },
  volumes: {
    proc: "settings.cleanUnusedVolumes",
    label: "Kullanılmayan volume'lar",
    hint: "Hiçbir container'a bağlı olmayan volume'lar KALICI silinir. Durdurulmuş bir veritabanının verisi de buna dahildir.",
    danger: true,
  },
} as const;

export type CleanupAction = keyof typeof CLEANUP_ACTIONS;

/** Grafik aralıkları; bucketMs = 0 → ham ölçüm. */
export const RANGES = {
  "24h": { label: "24 saat", ms: 24 * 3_600_000, bucketMs: 0 },
  "7d": { label: "7 gün", ms: 7 * 86_400_000, bucketMs: 3_600_000 },
  "30d": { label: "30 gün", ms: 30 * 86_400_000, bucketMs: 4 * 3_600_000 },
} as const;
export type RangeKey = keyof typeof RANGES;
