/**
 * Meta Marketing API yazma yardımcıları.
 * Canlı yazım: çağıran allowLive=true vermeli ve META_ADS_WRITE=1 olmalı.
 * Her deneme (dry-run dahil) recordMetaWriteCall ile kaydedilir.
 */
import { getMetaSystemUserToken } from "@/lib/integrations/tokens";
import { graphFetch, MetaGraphError } from "@/lib/integrations/meta/graph";
import { recordMetaWriteCall } from "@/lib/integrations/meta/write-log";

const GRAPH = "https://graph.facebook.com/v21.0";

export function metaAdsWriteEnabled(): boolean {
  return (process.env.META_ADS_WRITE || "").trim() === "1";
}

function actId(raw: string): string {
  return raw.startsWith("act_") ? raw : `act_${raw.replace(/\D/g, "")}`;
}

export type MetaWriteContext = {
  allowLive?: boolean;
  tenantId?: string | null;
  jobId?: string | null;
  stepId?: string | null;
};

export async function graphPost<T = unknown>(
  path: string,
  body: Record<string, unknown>,
  opts?: MetaWriteContext,
): Promise<{ res: Response; json: T; dryRun: boolean }> {
  const allowLive = opts?.allowLive === true && metaAdsWriteEnabled();
  const pathLabel = path.startsWith("http")
    ? path.replace(/access_token=[^&]+/gi, "access_token=REDACTED")
    : path.replace(/^\//, "");

  if (!allowLive) {
    await recordMetaWriteCall({
      dryRun: true,
      path: pathLabel,
      body,
      httpStatus: 200,
      tenantId: opts?.tenantId,
      jobId: opts?.jobId,
      stepId: opts?.stepId,
    });
    return {
      res: new Response(null, { status: 200 }),
      json: { id: `dryrun_${Date.now()}`, dry_run: true, path, body } as T,
      dryRun: true,
    };
  }

  const token = getMetaSystemUserToken();
  const url = path.startsWith("http")
    ? path
    : `${GRAPH}/${path.replace(/^\//, "")}`;
  const form = new URLSearchParams();
  form.set("access_token", token);
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined || v === null) continue;
    form.set(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  try {
    const { res, json } = await graphFetch<T>(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const err = (json as { error?: { message?: string; code?: number } })?.error;
    if (!res.ok || err) {
      await recordMetaWriteCall({
        dryRun: false,
        path: pathLabel,
        body,
        httpStatus: res.status,
        error: err?.message || `Meta POST ${res.status}`,
        metaCode: err?.code ?? null,
        tenantId: opts?.tenantId,
        jobId: opts?.jobId,
        stepId: opts?.stepId,
      });
      throw new MetaGraphError(
        err?.message || `Meta POST ${res.status}`,
        res.status,
        err?.code ?? null,
      );
    }
    await recordMetaWriteCall({
      dryRun: false,
      path: pathLabel,
      body,
      httpStatus: res.status,
      tenantId: opts?.tenantId,
      jobId: opts?.jobId,
      stepId: opts?.stepId,
    });
    return { res, json, dryRun: false };
  } catch (e) {
    if (e instanceof MetaGraphError) throw e;
    const message = e instanceof Error ? e.message : String(e);
    await recordMetaWriteCall({
      dryRun: false,
      path: pathLabel,
      body,
      error: message,
      tenantId: opts?.tenantId,
      jobId: opts?.jobId,
      stepId: opts?.stepId,
    });
    throw e;
  }
}

export async function updateAdStatus(
  adId: string,
  status: "ACTIVE" | "PAUSED",
  opts?: MetaWriteContext,
) {
  return graphPost(adId, { status }, opts);
}

export async function updateAdsetStatus(
  adsetId: string,
  status: "ACTIVE" | "PAUSED",
  opts?: MetaWriteContext,
) {
  return graphPost(adsetId, { status }, opts);
}

export async function updateAdsetDailyBudget(
  adsetId: string,
  dailyBudgetMinor: number,
  opts?: MetaWriteContext,
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
  configured_status?: string;
  ad_review_feedback?: unknown;
  creative?: { id?: string };
}> {
  const token = getMetaSystemUserToken();
  const url = `${GRAPH}/${adId}?fields=id,name,status,effective_status,configured_status,ad_review_feedback,creative{id}&access_token=${encodeURIComponent(token)}`;
  const { res, json } = await graphFetch<{
    id?: string;
    name?: string;
    status?: string;
    effective_status?: string;
    configured_status?: string;
    ad_review_feedback?: unknown;
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
    configured_status: json.configured_status,
    ad_review_feedback: json.ad_review_feedback,
    creative: json.creative,
  };
}

/**
 * K2a geniş okuma — Marketing API AdCreative fields (v25–v27).
 * object_story_spec tam alt ağaç; asset_feed / DOF / IG / crops dahil.
 */
export const CREATIVE_EDIT_FIELDS = [
  "id",
  "name",
  "account_id",
  "actor_id",
  "url_tags",
  "object_story_id",
  "effective_object_story_id",
  "image_hash",
  "image_crops",
  "image_url",
  "video_id",
  "object_type",
  "instagram_user_id",
  "instagram_permalink_url",
  "effective_instagram_media_id",
  "degrees_of_freedom_spec",
  "asset_feed_spec",
  "authorization_category",
  "use_page_actor_override",
  "applink_treatment",
  "platform_customizations",
  "product_set_id",
  "template_url",
  "template_url_spec",
  "call_to_action_type",
  "thumbnail_url",
  "status",
  "object_story_spec",
].join(",");

export type LiveCreativeSnapshot = Record<string, unknown> & {
  id: string;
  name?: string;
  url_tags?: string | null;
  object_story_id?: string | null;
  effective_object_story_id?: string | null;
  image_hash?: string | null;
  video_id?: string | null;
  object_type?: string | null;
  instagram_user_id?: string | null;
  object_story_spec?: Record<string, unknown> | null;
  asset_feed_spec?: unknown;
  degrees_of_freedom_spec?: unknown;
  product_set_id?: string | null;
};

export async function fetchLiveCreativeById(
  creativeId: string,
): Promise<LiveCreativeSnapshot> {
  const token = getMetaSystemUserToken();
  const url = `${GRAPH}/${creativeId}?fields=${CREATIVE_EDIT_FIELDS}&access_token=${encodeURIComponent(token)}`;
  const { res, json } = await graphFetch<
    LiveCreativeSnapshot & { error?: { message?: string } }
  >(url);
  if (!res.ok || json.error || !json.id) {
    throw new MetaGraphError(
      json.error?.message || `Meta creative snapshot ${res.status}`,
      res.status,
    );
  }
  return json;
}

/** Reklamın bağlı kreatifi — ad → creative id → detay. */
export async function fetchLiveAdCreative(adId: string): Promise<{
  adId: string;
  creative: LiveCreativeSnapshot;
}> {
  const ad = await fetchLiveAdSnapshot(adId);
  const creativeId = ad.creative?.id;
  if (!creativeId) {
    throw new MetaGraphError("Reklamda kreatif kimliği yok", 400);
  }
  const creative = await fetchLiveCreativeById(creativeId);
  return { adId: ad.id, creative };
}

export async function createAdCreative(
  adAccountId: string,
  body: Record<string, unknown>,
  opts?: MetaWriteContext,
) {
  const account = actId(adAccountId);
  return graphPost<{ id?: string }>(`${account}/adcreatives`, body, opts);
}

export async function bindAdCreative(
  adId: string,
  creativeId: string,
  opts?: MetaWriteContext,
) {
  return graphPost(adId, { creative: { creative_id: creativeId } }, opts);
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

export async function fetchLiveCampaignSnapshot(campaignId: string): Promise<{
  id: string;
  status: string;
  effective_status?: string;
  daily_budget?: string;
  lifetime_budget?: string;
}> {
  const token = getMetaSystemUserToken();
  const url = `${GRAPH}/${campaignId}?fields=id,status,effective_status,daily_budget,lifetime_budget&access_token=${encodeURIComponent(token)}`;
  const { res, json } = await graphFetch<{
    id?: string;
    status?: string;
    effective_status?: string;
    daily_budget?: string;
    lifetime_budget?: string;
    error?: { message?: string };
  }>(url);
  if (!res.ok || json.error || !json.id) {
    throw new MetaGraphError(
      json.error?.message || `Meta campaign snapshot ${res.status}`,
      res.status,
    );
  }
  return {
    id: json.id,
    status: json.status || "",
    effective_status: json.effective_status,
    daily_budget: json.daily_budget,
    lifetime_budget: json.lifetime_budget,
  };
}

export { actId };
