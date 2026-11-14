/**
 * Meta kampanya / reklam seti yapı sync (arşiv + silinmiş hariç).
 * Bütçe minor unit string olarak saklanır (Graph ile aynı).
 */
import { getMetaSystemUserToken } from "@/lib/integrations/tokens";
import { graphFetch } from "@/lib/integrations/meta/graph";

const GRAPH = "https://graph.facebook.com/v21.0";

const EXCLUDED_EFFECTIVE = ["DELETED", "ARCHIVED"] as const;

export type MetaBudgetKind = "daily" | "lifetime" | "none";
export type MetaBudgetLevel = "campaign" | "adset" | "none";

export type MetaCampaignStructureRow = {
  campaignId: string;
  campaignName: string;
  status: string;
  effectiveStatus: string;
  dailyBudgetMinor: string | null;
  lifetimeBudgetMinor: string | null;
  budgetLevel: MetaBudgetLevel;
  budgetKind: MetaBudgetKind;
};

export type MetaAdSetStructureRow = {
  adsetId: string;
  adsetName: string;
  campaignId: string;
  campaignName: string;
  status: string;
  effectiveStatus: string;
  dailyBudgetMinor: string | null;
  lifetimeBudgetMinor: string | null;
  budgetKind: MetaBudgetKind;
};

type GraphErr = {
  message?: string;
  code?: number;
  error_subcode?: number;
  error_user_msg?: string;
};

function graphErrorText(err: GraphErr | undefined, fallback: string): string {
  if (!err) return fallback;
  const parts = [err.message || fallback];
  if (err.error_user_msg) parts.push(err.error_user_msg);
  const codes = [
    err.code != null ? `#${err.code}` : null,
    err.error_subcode != null ? `sub ${err.error_subcode}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return `${parts.join(" — ")}${codes ? ` (${codes})` : ""}`;
}

function actId(metaAccountId: string): string {
  return metaAccountId.startsWith("act_")
    ? metaAccountId
    : `act_${metaAccountId}`;
}

function minorOrNull(raw: string | number | undefined | null): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const s = String(raw).trim();
  if (!s || s === "0") return s === "0" ? "0" : s;
  return s;
}

export function deriveBudgetKind(
  daily: string | null,
  lifetime: string | null,
): MetaBudgetKind {
  const hasDaily = daily != null && daily !== "" && Number(daily) > 0;
  const hasLife = lifetime != null && lifetime !== "" && Number(lifetime) > 0;
  if (hasDaily) return "daily";
  if (hasLife) return "lifetime";
  return "none";
}

function notDeletedFilter(): string {
  return JSON.stringify([
    {
      field: "effective_status",
      operator: "NOT_IN",
      value: [...EXCLUDED_EFFECTIVE],
    },
  ]);
}

export async function fetchMetaCampaignStructure(opts: {
  metaAccountId: string;
}): Promise<MetaCampaignStructureRow[]> {
  const token = getMetaSystemUserToken();
  const account = actId(opts.metaAccountId);
  const fields = [
    "id",
    "name",
    "status",
    "effective_status",
    "daily_budget",
    "lifetime_budget",
  ].join(",");

  const rows: MetaCampaignStructureRow[] = [];
  let limit = 100;
  for (let attempt = 0; attempt < 2; attempt++) {
    rows.length = 0;
    const params = new URLSearchParams({
      access_token: token,
      fields,
      limit: String(limit),
      filtering: notDeletedFilter(),
    });
    let url: string | null = `${GRAPH}/${account}/campaigns?${params}`;
    let failed = false;
    while (url) {
      const { res, json: rawJson } = await graphFetch(url);
      const json = rawJson as {
        data?: Array<{
          id?: string;
          name?: string;
          status?: string;
          effective_status?: string;
          daily_budget?: string;
          lifetime_budget?: string;
        }>;
        paging?: { next?: string };
        error?: GraphErr;
      };
      if (!res.ok || json.error) {
        const msg = graphErrorText(
          json.error,
          `Meta campaigns ${res.status} for ${account}`,
        );
        if (/reduce the amount of data/i.test(msg) && limit > 25) {
          limit = 25;
          failed = true;
          break;
        }
        throw new Error(msg);
      }
      for (const c of json.data ?? []) {
        if (!c.id) continue;
        const daily = minorOrNull(c.daily_budget);
        const lifetime = minorOrNull(c.lifetime_budget);
        const budgetKind = deriveBudgetKind(daily, lifetime);
        const budgetLevel: MetaBudgetLevel =
          budgetKind === "none" ? "adset" : "campaign";
        rows.push({
          campaignId: c.id,
          campaignName: c.name || c.id,
          status: c.status || "",
          effectiveStatus: c.effective_status || c.status || "",
          dailyBudgetMinor: daily,
          lifetimeBudgetMinor: lifetime,
          budgetLevel,
          budgetKind,
        });
      }
      url = json.paging?.next ?? null;
    }
    if (!failed) break;
  }
  return rows;
}

export async function fetchMetaAdSetStructure(opts: {
  metaAccountId: string;
}): Promise<MetaAdSetStructureRow[]> {
  const token = getMetaSystemUserToken();
  const account = actId(opts.metaAccountId);
  const fields = [
    "id",
    "name",
    "status",
    "effective_status",
    "campaign_id",
    "campaign{name}",
    "daily_budget",
    "lifetime_budget",
  ].join(",");

  const rows: MetaAdSetStructureRow[] = [];
  let limit = 100;
  for (let attempt = 0; attempt < 2; attempt++) {
    rows.length = 0;
    const params = new URLSearchParams({
      access_token: token,
      fields,
      limit: String(limit),
      filtering: notDeletedFilter(),
    });
    let url: string | null = `${GRAPH}/${account}/adsets?${params}`;
    let failed = false;
    while (url) {
      const { res, json: rawJson } = await graphFetch(url);
      const json = rawJson as {
        data?: Array<{
          id?: string;
          name?: string;
          status?: string;
          effective_status?: string;
          campaign_id?: string;
          campaign?: { id?: string; name?: string };
          daily_budget?: string;
          lifetime_budget?: string;
        }>;
        paging?: { next?: string };
        error?: GraphErr;
      };
      if (!res.ok || json.error) {
        const msg = graphErrorText(
          json.error,
          `Meta adsets ${res.status} for ${account}`,
        );
        if (/reduce the amount of data/i.test(msg) && limit > 25) {
          limit = 25;
          failed = true;
          break;
        }
        throw new Error(msg);
      }
      for (const a of json.data ?? []) {
        if (!a.id) continue;
        const daily = minorOrNull(a.daily_budget);
        const lifetime = minorOrNull(a.lifetime_budget);
        rows.push({
          adsetId: a.id,
          adsetName: a.name || a.id,
          campaignId: a.campaign_id || a.campaign?.id || "",
          campaignName: a.campaign?.name || "",
          status: a.status || "",
          effectiveStatus: a.effective_status || a.status || "",
          dailyBudgetMinor: daily,
          lifetimeBudgetMinor: lifetime,
          budgetKind: deriveBudgetKind(daily, lifetime),
        });
      }
      url = json.paging?.next ?? null;
    }
    if (!failed) break;
  }
  return rows;
}
