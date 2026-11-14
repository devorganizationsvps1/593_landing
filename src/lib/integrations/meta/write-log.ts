/**
 * Meta yazma (ve dry-run) istek kaydı.
 * Token asla loglanmaz. Asıl işlemi bozmaz.
 * audit dinamik import — testlerde next/auth çekmesin.
 */

export type MetaWriteLogEntry = {
  at: string;
  dryRun: boolean;
  method: "POST" | "GET";
  path: string;
  /** access_token hariç gövde */
  body?: Record<string, unknown>;
  httpStatus?: number | null;
  error?: string | null;
  metaCode?: number | null;
};

const MAX_RING = 200;
const ring: MetaWriteLogEntry[] = [];

function redactBody(body: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!body) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (/token|secret|password/i.test(k)) continue;
    out[k] = v;
  }
  return out;
}

/** Son kayıtlar (test / ops teşhis). */
export function getRecentMetaWriteLogs(limit = 50): MetaWriteLogEntry[] {
  return ring.slice(-limit);
}

export function clearMetaWriteLogsForTests(): void {
  ring.length = 0;
}

export async function recordMetaWriteCall(opts: {
  dryRun: boolean;
  method?: "POST" | "GET";
  path: string;
  body?: Record<string, unknown>;
  httpStatus?: number | null;
  error?: string | null;
  metaCode?: number | null;
  tenantId?: string | null;
  jobId?: string | null;
  stepId?: string | null;
}): Promise<MetaWriteLogEntry> {
  const entry: MetaWriteLogEntry = {
    at: new Date().toISOString(),
    dryRun: opts.dryRun,
    method: opts.method ?? "POST",
    path: opts.path.replace(/access_token=[^&]+/gi, "access_token=REDACTED"),
    body: redactBody(opts.body),
    httpStatus: opts.httpStatus ?? null,
    error: opts.error ?? null,
    metaCode: opts.metaCode ?? null,
  };
  ring.push(entry);
  if (ring.length > MAX_RING) ring.splice(0, ring.length - MAX_RING);

  console.info(
    "[meta.write]",
    entry.dryRun ? "DRY_RUN" : "LIVE",
    entry.method,
    entry.path,
    entry.error ? `ERR ${entry.error}` : "ok",
  );

  try {
    const { audit } = await import("@/lib/panel/audit");
    await audit(null, {
      action: opts.dryRun ? "meta.write.dry_run" : "meta.write.live",
      entity: "meta_write",
      entityId: opts.stepId ?? opts.jobId ?? null,
      tenantId: opts.tenantId ?? null,
      summary: `${entry.dryRun ? "dry-run" : "LIVE"} ${entry.method} ${entry.path}`,
      after: {
        ...entry,
        jobId: opts.jobId ?? null,
        stepId: opts.stepId ?? null,
      },
    });
  } catch (err) {
    console.warn("[meta.write.audit]", err);
  }

  return entry;
}
