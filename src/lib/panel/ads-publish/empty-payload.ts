import type { AdChangePlatform } from "@prisma/client";
import type { AdChangePayload } from "@/lib/panel/ads-publish/types";

export function emptyAdChangePayload(opts: {
  tenantId: string;
  platform: AdChangePlatform;
  adAccountId: string;
  dateStart: string;
  dateEnd: string;
}): AdChangePayload {
  return {
    target: {
      tenantId: opts.tenantId,
      platform: opts.platform,
      adAccountId: opts.adAccountId,
    },
    rationale: {
      dateStart: opts.dateStart,
      dateEnd: opts.dateEnd,
      conversionMetric: "",
      spend: null,
      conversions: null,
      cpa: null,
      roas: null,
      targetCpa: null,
      targetRoas: null,
      notes: "",
    },
    changes: [],
    plan: [],
    media: [],
  };
}
