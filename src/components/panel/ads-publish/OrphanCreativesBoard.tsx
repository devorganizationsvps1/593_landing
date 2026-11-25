"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/panel/ds/EmptyState";
import { btnSecondary } from "@/components/panel/ds/buttons";

type Row = {
  id: string;
  tenantSlug: string;
  tenantName: string;
  adAccountId: string;
  creativeId: string;
  adId: string;
  packageId: string | null;
  reason: string;
  createdAt: string;
  resolvedAt: string | null;
};

const REASON_LABEL: Record<string, string> = {
  readback_mismatch: "Geri okuma uyuşmazlığı",
  bind_failed: "Bağlama başarısız",
  bind_verify_failed: "Bağlama doğrulanamadı",
};

export default function OrphanCreativesBoard({
  actorName,
  initial,
}: {
  actorName: string;
  initial: Row[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const open = initial.filter((r) => !r.resolvedAt);

  async function resolve(id: string) {
    setBusy(id);
    try {
      await fetch("/api/panel/ads-publish/orphans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolve", id }),
      });
      startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold tracking-tight">
          Sahipsiz kreatifler
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-zinc-500">
          Create sonrası geri okuma veya bağlama başarısız olduğunda kaydedilen
          Meta kreatif kimlikleri · {actorName}
        </p>
      </header>

      {open.length === 0 ? (
        <EmptyState
          title="Açık sahipsiz kreatif yok"
          description="K2a create→bind akışında read-back veya bind hatası olursa burada listelenir."
        />
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200 bg-white">
          {open.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0 text-sm">
                <p className="font-medium text-zinc-900">
                  {r.tenantName}{" "}
                  <span className="font-mono text-xs text-zinc-500">
                    {r.creativeId}
                  </span>
                </p>
                <p className="text-xs text-zinc-500">
                  {REASON_LABEL[r.reason] || r.reason}
                  {r.adId ? ` · ad ${r.adId}` : ""}
                  {r.adAccountId ? ` · ${r.adAccountId}` : ""}
                </p>
                <p className="text-[11px] text-zinc-400">
                  {new Date(r.createdAt).toLocaleString("tr-TR")}
                </p>
              </div>
              <button
                type="button"
                className={btnSecondary}
                disabled={busy !== null}
                onClick={() => void resolve(r.id)}
              >
                Çözüldü işaretle
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
