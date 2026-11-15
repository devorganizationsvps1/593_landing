import tls from "node:tls";
import type { DomainInfo } from "./types";

export type SiteCheckResult = {
  host: string;
  ok: boolean;
  status: number | null;
  ms: number | null;
  sslExpiresAt: Date | null;
  error: string | null;
};

function sslExpiry(host: string): Promise<Date | null> {
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host, port: 443, servername: host, timeout: 8_000, rejectUnauthorized: false },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        const d = cert?.valid_to ? new Date(cert.valid_to) : null;
        resolve(d && !Number.isNaN(d.getTime()) ? d : null);
      },
    );
    socket.on("error", () => resolve(null));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(null);
    });
  });
}

/**
 * Domaine dışarıdan istek: 5xx dışındaki her yanıt "erişilebilir" sayılır
 * (401/404 de sunucunun cevap verdiğini gösterir). Yönlendirme izlenmez.
 */
export async function checkSite(d: DomainInfo): Promise<SiteCheckResult> {
  const url = `${d.https ? "https" : "http"}://${d.host}${d.path.startsWith("/") ? d.path : `/${d.path}`}`;
  const started = Date.now();
  const [http, ssl] = await Promise.all([
    fetch(url, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      headers: { "user-agent": "uptime-check/1.0" },
      signal: AbortSignal.timeout(12_000),
    }).then(
      async (res) => {
        const ms = Date.now() - started;
        await res.body?.cancel().catch(() => undefined);
        return { status: res.status, ms, error: null as string | null };
      },
      (err: unknown) => {
        const e = err as { cause?: { code?: string }; name?: string; message?: string };
        const code = e.cause?.code ?? (e.name === "TimeoutError" ? "Zaman aşımı" : e.message ?? "Bağlantı hatası");
        return { status: null, ms: null, error: String(code) };
      },
    ),
    d.https ? sslExpiry(d.host) : Promise.resolve(null),
  ]);
  return {
    host: d.host,
    ok: http.status != null && http.status < 500,
    status: http.status,
    ms: http.ms,
    sslExpiresAt: ssl,
    error: http.error ?? (http.status != null && http.status >= 500 ? `HTTP ${http.status}` : null),
  };
}
