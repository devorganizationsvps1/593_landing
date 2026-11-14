/**
 * Meta Marketing API yazma yardımcıları.
 * Gerçek yazım yalnızca META_ADS_WRITE=1 iken yapılır; aksi halde dry-run.
 */
import { getMetaSystemUserToken } from "@/lib/integrations/tokens";
import { graphFetch, MetaGraphError } from "@/lib/integrations/meta/graph";

const GRAPH = "https://graph.facebook.com/v21.0";

export function metaAdsWriteEnabled(): boolean {
  return (process.env.META_ADS_WRITE || "").trim() === "1";
}

function actId(raw: string): string {
  return raw.startsWith("act_") ? raw : `act_${raw.replace(/\D/g, "")}`;
}

export async function graphPost<T = unknown>(
  path: string,
  body: Record<string, unknown>,
): Promise<{ res: Response; json: T; dryRun: boolean }> {
  if (!metaAdsWriteEnabled()) {
    return {
      res: new Response(null, { status: 200 }),
      json: { id: `dryrun_${Date.now()}`, dry_run: true, path, body } as T,
      dryRun: true,
    };
  }
  const token = getMetaSystemUserToken();
  const url = path.startsWith("http") ? path : `${GRAPH}/${path.replace(/^\//, "")}`;
  const form = new URLSearchParams();
  form.set("access_token", token);
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined || v === null) continue;
    form.set(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  const { res, json } = await graphFetch<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const err = (json as { error?: { message?: string; code?: number } })?.error;
  if (!res.ok || err) {
    throw new MetaGraphError(
      err?.message || `Meta POST ${res.status}`,
      res.status,
      err?.code ?? null,
    );
  }
  return { res, json, dryRun: false };
}

export async function updateAdStatus(adId: string, status: "ACTIVE" | "PAUSED") {
  return graphPost(adId, { status });
}

export async function updateAdsetStatus(
  adsetId: string,
  status: "ACTIVE" | "PAUSED",
) {
  return graphPost(adsetId, { status });
}

export async function updateAdsetDailyBudget(
  adsetId: string,
  dailyBudgetMinor: number,
) {
  // Meta minor units (kuruş): TRY * 100
  return graphPost(adsetId, { daily_budget: Math.round(dailyBudgetMinor) });
}

export async function fetchLiveAdSnapshot(adId: string): Promise<{
  id: string;
  name: string;
  status: string;
  effective_status?: string;
  creative?: { id?: string };
}> {
  const token = getMetaSystemUserToken();
  const url = `${GRAPH}/${adId}?fields=id,name,status,effective_status,creative{id}&access_token=${encodeURIComponent(token)}`;
  const { res, json } = await graphFetch<{
    id?: string;
    name?: string;
    status?: string;
    effective_status?: string;
    creative?: { id?: string };
    error?: { message?: string };
  }>(url);
  if (!res.ok || json.error || !json.id) {
    throw new MetaGraphError(
      json.error?.message || `Meta ad snapshot ${res.status}`,
      res.status,
    );
  }
  return {
    id: json.id,
    name: json.name || json.id,
    status: json.status || "",
    effective_status: json.effective_status,
    creative: json.creative,
  };
}

export { actId };
