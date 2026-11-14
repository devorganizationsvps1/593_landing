/**
 * Meta canlı yazma — üç kapı + kind izin listesi.
 * Graph yalnızca: global META_ADS_WRITE ∧ tenant.metaAdsWriteEnabled ∧ kademe kind’i.
 */
import {
  isWriteKindAllowed,
  WRITE_KINDS_K1,
  WRITE_KINDS_K2,
  WRITE_KINDS_K3,
  WRITE_KINDS_K4,
  type WriteTierFlags,
} from "@/lib/panel/ads-publish/write-kinds";
import { metaAdsWriteEnabled } from "@/lib/integrations/meta/write";

export type WriteGateReason =
  | "global_META_ADS_WRITE"
  | "tenant_metaAdsWriteEnabled"
  | "tier_K1"
  | "tier_K2"
  | "tier_K3"
  | "tier_K4"
  | "kind_not_in_allowlist";

export type WriteGateDecision = {
  /** Gerçek Graph POST */
  action: "apply" | "simulate" | "skip";
  missing: WriteGateReason[];
  globalWrite: boolean;
  tenantWrite: boolean;
  kindAllowed: boolean;
  tierFlags: WriteTierFlags;
};

export type TenantWriteFlags = {
  metaAdsWriteEnabled: boolean;
  metaAdsWriteTierK1: boolean;
  metaAdsWriteTierK2: boolean;
  metaAdsWriteTierK3: boolean;
  metaAdsWriteTierK4: boolean;
};

export function tierFlagsFromTenant(tenant: TenantWriteFlags): WriteTierFlags {
  return {
    k1: tenant.metaAdsWriteTierK1,
    k2: tenant.metaAdsWriteTierK2,
    k3: tenant.metaAdsWriteTierK3,
    k4: tenant.metaAdsWriteTierK4,
  };
}

function tierReasonForKind(
  kind: string,
  flags: WriteTierFlags,
): WriteGateReason | null {
  if (WRITE_KINDS_K1.includes(kind)) {
    return flags.k1 ? null : "tier_K1";
  }
  if (WRITE_KINDS_K2.includes(kind)) {
    return flags.k2 ? null : "tier_K2";
  }
  if (WRITE_KINDS_K3.includes(kind)) {
    return flags.k3 ? null : "tier_K3";
  }
  if (WRITE_KINDS_K4.includes(kind)) {
    return flags.k4 ? null : "tier_K4";
  }
  return "kind_not_in_allowlist";
}

export function evaluateWriteGates(opts: {
  kind: string;
  globalWrite: boolean;
  tenantWrite: boolean;
  tierFlags: WriteTierFlags;
}): WriteGateDecision {
  const kindAllowed = isWriteKindAllowed(opts.kind, opts.tierFlags);
  const missing: WriteGateReason[] = [];

  if (!kindAllowed) {
    const tierReason = tierReasonForKind(opts.kind, opts.tierFlags);
    missing.push(tierReason ?? "kind_not_in_allowlist");
    return {
      action: "skip",
      missing,
      globalWrite: opts.globalWrite,
      tenantWrite: opts.tenantWrite,
      kindAllowed: false,
      tierFlags: opts.tierFlags,
    };
  }

  if (!opts.globalWrite) missing.push("global_META_ADS_WRITE");
  if (!opts.tenantWrite) missing.push("tenant_metaAdsWriteEnabled");

  if (missing.length > 0) {
    return {
      action: "simulate",
      missing,
      globalWrite: opts.globalWrite,
      tenantWrite: opts.tenantWrite,
      kindAllowed: true,
      tierFlags: opts.tierFlags,
    };
  }

  return {
    action: "apply",
    missing: [],
    globalWrite: true,
    tenantWrite: true,
    kindAllowed: true,
    tierFlags: opts.tierFlags,
  };
}

/** Ortam + tenant’tan karar (üretim yolu). */
export function decideStepWrite(
  kind: string,
  tenant: TenantWriteFlags,
): WriteGateDecision {
  return evaluateWriteGates({
    kind,
    globalWrite: metaAdsWriteEnabled(),
    tenantWrite: tenant.metaAdsWriteEnabled,
    tierFlags: tierFlagsFromTenant(tenant),
  });
}

export const WRITE_GATE_REASON_LABEL: Record<WriteGateReason, string> = {
  global_META_ADS_WRITE: "Global META_ADS_WRITE kapalı",
  tenant_metaAdsWriteEnabled: "Tenant metaAdsWriteEnabled kapalı",
  tier_K1: "Kademe K1 kapalı",
  tier_K2: "Kademe K2 kapalı",
  tier_K3: "Kademe K3 kapalı",
  tier_K4: "Kademe K4 kapalı",
  kind_not_in_allowlist: "Tür izin listesinde yok",
};

export function formatMissingGates(missing: WriteGateReason[]): string {
  return missing.map((m) => WRITE_GATE_REASON_LABEL[m] ?? m).join("; ");
}

/**
 * Adım sonuçlarından job/paket durumunu çıkar.
 * Paket yalnızca tüm adımlar applied ise applied.
 */
export function aggregateOutcome(
  stepStatuses: Array<"applied" | "simulated" | "skipped" | "failed">,
): "applied" | "simulated" | "skipped" | "partial" | "failed" {
  if (stepStatuses.length === 0) return "skipped";
  if (stepStatuses.some((s) => s === "failed")) return "failed";
  const set = new Set(stepStatuses);
  if (set.size === 1) {
    const only = stepStatuses[0]!;
    if (only === "applied") return "applied";
    if (only === "simulated") return "simulated";
    if (only === "skipped") return "skipped";
  }
  return "partial";
}
