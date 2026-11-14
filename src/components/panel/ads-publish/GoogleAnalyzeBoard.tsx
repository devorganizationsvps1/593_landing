"use client";

import { Suspense } from "react";
import { EmptyState } from "@/components/panel/ds/EmptyState";
import PeriodFilterBar from "@/components/panel/PeriodFilterBar";
import type { GoogleAnalyzeSnapshot } from "@/lib/panel/ads-publish/google-analyze";
import { formatConv, formatNumber, formatTry } from "@/lib/panel/format";

export default function GoogleAnalyzeBoard({
  snapshot,
  rangeLabel,
}: {
  snapshot: GoogleAnalyzeSnapshot;
  rangeLabel: string;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Google analiz</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Mevcut Google Ads kampanya metrikleri. Para birimi, hesap saat dilimi ve
          dönüşüm kolonu marka satırında. Yazma yok — analiz ve öneri girdisi.
        </p>
      </div>

      <Suspense fallback={null}>
        <PeriodFilterBar label={rangeLabel} />
      </Suspense>

      <p className="text-xs text-zinc-500">
        Dönem {snapshot.startDate} → {snapshot.endDate}. {snapshot.conversionColumn}.
      </p>

      {snapshot.brands.length === 0 ? (
        <EmptyState
          title="Google Ads verisi yok"
          description="Bu dönemde harcama kaydı veya bağlı hesap bulunmuyor."
        />
      ) : (
        <div className="space-y-4">
          {snapshot.brands.map((brand) => (
            <section
              key={brand.id}
              className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-100 px-5 py-4">
                <div>
                  <h3 className="text-sm font-semibold">{brand.name}</h3>
                  <p className="mt-0.5 text-[11px] text-zinc-500">
                    Hesap {brand.adsCustomerId ?? "eşleşmedi"} · {brand.timezone} ·{" "}
                    {brand.currency} · {brand.conversionColumn}
                  </p>
                </div>
                <p className="text-xs text-zinc-500">
                  {formatTry(brand.cost, brand.currency)} · {formatConv(brand.conversions)} dönüşüm
                </p>
              </div>
              {brand.campaigns.length === 0 ? (
                <p className="px-5 py-4 text-sm text-zinc-400">Bu dönemde kampanya harcaması yok.</p>
              ) : (
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500">
                    <tr>
                      <th className="px-5 py-2.5 font-medium">Kampanya</th>
                      <th className="px-3 py-2.5 text-right font-medium">Harcama</th>
                      <th className="px-3 py-2.5 text-right font-medium">Gösterim</th>
                      <th className="px-3 py-2.5 text-right font-medium">Tıklama</th>
                      <th className="px-3 py-2.5 text-right font-medium">Dönüşüm</th>
                      <th className="px-3 py-2.5 text-right font-medium">CPA</th>
                      <th className="px-5 py-2.5 text-right font-medium">ROAS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {brand.campaigns.map((c) => (
                      <tr key={c.campaignId} className="border-t border-zinc-50">
                        <td className="px-5 py-2.5 font-medium">{c.campaignName}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {formatTry(c.cost, brand.currency)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {formatNumber(c.impressions, 0)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {formatNumber(c.clicks, 0)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {formatConv(c.conversions)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {c.cpa == null ? "—" : formatTry(c.cpa, brand.currency)}
                        </td>
                        <td className="px-5 py-2.5 text-right tabular-nums">
                          {c.roas == null ? "—" : formatNumber(c.roas, 2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
