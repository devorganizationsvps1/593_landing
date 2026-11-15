/**
 * DOKPLOY_MOCK=1 — Dokploy API'sinin gerçek yanıt şekillerini taklit eden
 * örnek veri. Yalnızca yerel geliştirme / arayüz kontrolü içindir.
 */
import type { DokployInstance } from "./config";

const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const dep = (id: string, status: string, ago: number, title = "Deploy") => ({
  deploymentId: id,
  title,
  status,
  createdAt: day(ago),
  errorMessage: status === "error" ? "npm run build exited with code 1" : null,
});

const DATA: Record<string, { projects: unknown[]; details: Record<string, unknown> }> = {
  "1": {
    projects: [
      {
        projectId: "p-panel",
        name: "593 Panel",
        description: "Ajans paneli ve site",
        createdAt: day(410),
        environments: [
          {
            name: "production",
            applications: [{ applicationId: "a-panel", name: "panel", applicationStatus: "done" }],
            postgres: [{ postgresId: "pg-panel", name: "panel-db", applicationStatus: "done" }],
            compose: [],
          },
        ],
      },
      {
        projectId: "p-n8n",
        name: "Otomasyon",
        description: null,
        createdAt: day(190),
        environments: [
          {
            name: "production",
            compose: [{ composeId: "c-n8n", name: "n8n", composeStatus: "done" }],
            redis: [{ redisId: "r-n8n", name: "n8n-queue", applicationStatus: "idle" }],
          },
        ],
      },
    ],
    details: {
      "a-panel": {
        applicationId: "a-panel", name: "panel", appName: "panel-x1y2", applicationStatus: "done",
        createdAt: day(409), serverId: null,
        domains: [{ host: "example.com", https: true, path: "/" }, { host: "www.iana.org", https: true, path: "/" }],
        deployments: [dep("d1", "done", 0.2, "fix: layout"), dep("d0", "done", 3)],
      },
      "pg-panel": { postgresId: "pg-panel", name: "panel-db", appName: "panel-db-a1", applicationStatus: "done", createdAt: day(409), serverId: null },
      "c-n8n": {
        composeId: "c-n8n", name: "n8n", appName: "n8n-q9", composeStatus: "done", createdAt: day(188), serverId: null,
        domains: [{ host: "does-not-exist.invalid", https: true, path: "/" }],
        deployments: [dep("d2", "done", 40)],
      },
      "r-n8n": { redisId: "r-n8n", name: "n8n-queue", appName: "n8n-queue-b2", applicationStatus: "idle", createdAt: day(188), serverId: null },
    },
  },
  "2": {
    projects: [
      {
        projectId: "p-shop",
        name: "Müşteri siteleri",
        description: "Landing ve mağazalar",
        createdAt: day(120),
        environments: [
          {
            name: "production",
            applications: [
              { applicationId: "a-shop", name: "magaza", applicationStatus: "error" },
              { applicationId: "a-land", name: "landing", applicationStatus: "done" },
            ],
            mysql: [{ mysqlId: "my-shop", name: "magaza-db", applicationStatus: "done" }],
          },
        ],
      },
    ],
    details: {
      "a-shop": {
        applicationId: "a-shop", name: "magaza", appName: "magaza-k3", applicationStatus: "error", createdAt: day(118), serverId: null,
        domains: [{ host: "example.org", https: true, path: "/" }],
        deployments: [dep("d9", "error", 0.05, "feat: sepet"), dep("d8", "done", 6)],
      },
      "a-land": {
        applicationId: "a-land", name: "landing", appName: "landing-m4", applicationStatus: "done", createdAt: day(60), serverId: null,
        domains: [{ host: "example.net", https: true, path: "/" }],
        deployments: [dep("d7", "done", 12)],
      },
      "my-shop": { mysqlId: "my-shop", name: "magaza-db", appName: "magaza-db-c5", applicationStatus: "done", createdAt: day(118), serverId: null },
    },
  },
};

export function mockCall(inst: DokployInstance, proc: string, input: Record<string, unknown>): unknown {
  const d = DATA[inst.id] ?? DATA["1"];
  const two = inst.id === "2";
  switch (proc) {
    case "project.all":
      return d.projects;
    case "server.all":
      return [];
    case "settings.getIp":
      return two ? "203.0.113.20" : "203.0.113.10";
    case "settings.getDokployVersion":
      return "v0.26.2";
    case "settings.getWebServerSettings":
      return {
        enableDockerCleanup: !two,
        metricsConfig: { server: { port: 4500, token: "mock-token" } },
      };
    case "server.getServerMetrics": {
      const wave = Math.sin(Date.now() / 600_000);
      return [
        {
          cpu: (two ? 34 : 18 + wave * 8).toFixed(2),
          cpuModel: "AMD EPYC 7543", cpuCores: two ? 4 : 8, cpuPhysicalCores: 1, cpuSpeed: 2800,
          os: "Ubuntu 24.04.1 LTS", distro: "Ubuntu 24.04.1 LTS", kernel: "6.8.0-45-generic", arch: "x86_64",
          memUsed: (two ? 71 : 52 + wave * 4).toFixed(2), memUsedGB: "8.30", memTotal: two ? "8.00" : "16.00",
          uptime: two ? 86_400 * 12 + 4000 : 86_400 * 143,
          diskUsed: two ? "88.40" : "61.20", totalDisk: two ? "80.00" : "160.00",
          networkIn: String(Math.round(Date.now() / 40_000) % 900_000), networkOut: String(Math.round(Date.now() / 90_000) % 900_000),
          timestamp: new Date().toISOString(),
        },
      ];
    }
    default: {
      if (proc.endsWith(".one")) {
        const id = Object.values(input)[0] as string;
        const row = d.details[id];
        if (!row) throw new Error("not found");
        return row;
      }
      if (proc.startsWith("settings.clean") || proc === "settings.updateDockerCleanup") return true;
      throw new Error(`mock: ${proc} tanımlı değil`);
    }
  }
}
