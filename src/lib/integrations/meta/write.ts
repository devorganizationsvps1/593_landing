/**
 * Meta Marketing API yazma yardımcıları.
 * Canlı yazım: çağıran allowLive=true vermeli ve META_ADS_WRITE=1 olmalı.
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
  opts?: { allowLive?: boolean },
): Promise<{ res: Response; json: T; dryRun: boolean }> {
  const allowLive = opts?.allowLive === true && metaAdsWriteEnabled();
  if (!allowLive) {
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

export async function updateAdStatus(
  adId: string,
  status: "ACTIVE" | "PAUSED",
  opts?: { allowLive?: boolean },
) {
  return graphPost(adId, { status }, opts);
}

export async function updateAdsetStatus(
  adsetId: string,
  status: "ACTIVE" | "PAUSED",
  opts?: { allowLive?: boolean },
) {
  return graphPost(adsetId, { status }, opts);
}

export async function updateAdsetDailyBudget(
  adsetId: string,
  dailyBudgetMinor: number,
  opts?: { allowLive?: boolean },
) {
  return graphPost(
    adsetId,
    { daily_budget: Math.round(dailyBudgetMinor) },
    opts,
  );
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

export async function fetchLiveAdsetSnapshot(adsetId: string): Promise<{
  id: string;
  status: string;
  effective_status?: string;
  daily_budget?: string;
}> {
  const token = getMetaSystemUserToken();
  const url = `${GRAPH}/${adsetId}?fields=id,status,effective_status,daily_budget&access_token=${encodeURIComponent(token)}`;
  const { res, json } = await graphFetch<{
    id?: string;
    status?: string;
    effective_status?: string;
    daily_budget?: string;
    error?: { message?: string };
  }>(url);
  if (!res.ok || json.error || !json.id) {
    throw new MetaGraphError(
      json.error?.message || `Meta adset snapshot ${res.status}`,
      res.status,
    );
  }
  return {
    id: json.id,
    status: json.status || "",
    effective_status: json.effective_status,
    daily_budget: json.daily_budget,
  };
}

export { actId };
