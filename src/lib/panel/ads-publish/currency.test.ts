import { describe, expect, it } from "vitest";
import {
  assertBudgetCurrencyAligned,
  assertPayloadBudgetLimits,
  BudgetCheckError,
} from "@/lib/panel/ads-publish/budget-check";
import {
  currenciesMismatch,
  currencyMismatchMessage,
  resolveBudgetDisplayCurrency,
} from "@/lib/panel/ads-publish/currency";
import type { AdChangePayload } from "@/lib/panel/ads-publish/types";

function budgetPayload(): AdChangePayload {
  return {
    target: {
      tenantId: "t",
      platform: "meta",
      adAccountId: "act_1",
      campaignId: "c1",
      adsetId: "as1",
    },
    rationale: {
      dateStart: "",
      dateEnd: "",
      conversionMetric: "",
      spend: null,
      conversions: null,
      cpa: null,
      roas: null,
      targetCpa: null,
      targetRoas: null,
      notes: "",
    },
    changes: [
      {
        field: "adset.daily_budget",
        label: "Günlük bütçe",
        current: 100,
        proposed: 110,
      },
    ],
    plan: [{ key: "adset.daily_budget", label: "Günlük bütçe" }],
    media: [],
  };
}

function statusPayload(): AdChangePayload {
  const p = budgetPayload();
  p.changes = [
    {
      field: "ad.status",
      label: "Reklam durumu",
      current: "ACTIVE",
      proposed: "PAUSED",
    },
  ];
  p.plan = [{ key: "ad.status", label: "Reklam durumu" }];
  return p;
}

describe("meta vs tenant currency", () => {
  it("mismatch detection", () => {
    expect(currenciesMismatch("TRY", "USD")).toBe(true);
    expect(currenciesMismatch("usd", "USD")).toBe(false);
    expect(currenciesMismatch("TRY", "")).toBe(false);
  });

  it("display prefers Meta account currency", () => {
    expect(
      resolveBudgetDisplayCurrency({
        tenantCurrency: "TRY",
        metaCurrency: "USD",
      }),
    ).toBe("USD");
  });

  it("USD account + TRY tenant → budget step rejected with clear reason", () => {
    expect(() =>
      assertBudgetCurrencyAligned({
        tenantCurrency: "TRY",
        metaCurrency: "USD",
        payload: budgetPayload(),
      }),
    ).toThrow(BudgetCheckError);

    try {
      assertPayloadBudgetLimits(budgetPayload(), {
        tenantCurrency: "TRY",
        metaCurrency: "USD",
      });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(BudgetCheckError);
      expect((e as BudgetCheckError).code).toBe("currency_mismatch");
      expect((e as Error).message).toMatch(/Para birimi uyuşmuyor/);
      expect((e as Error).message).toMatch(/panel TRY/);
      expect((e as Error).message).toMatch(/Meta hesap USD/);
      expect((e as Error).message).toMatch(/Bütçe düzenleme engellendi/);
    }
  });

  it("status-only change allowed despite currency mismatch", () => {
    expect(() =>
      assertPayloadBudgetLimits(statusPayload(), {
        tenantCurrency: "TRY",
        metaCurrency: "USD",
      }),
    ).not.toThrow();
  });

  it("message helper", () => {
    expect(currencyMismatchMessage("TRY", "USD")).toMatch(/TRY/);
    expect(currencyMismatchMessage("TRY", "USD")).toMatch(/USD/);
  });
});
