"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/panel/ds/EmptyState";
import { btnPrimary, btnSecondary, fieldClass } from "@/components/panel/ds/buttons";
import { META_FIELDS, META_FORMATS } from "@/lib/panel/ads-publish/matrix";
import {
  packageStatusLabel,
  type AdChangePackageListItem,
} from "@/lib/panel/ads-publish/types";

type Brand = { id: string; slug: string; name: string; metaAccountId: string };

export default function MetaPublishBoard({
  actorName,
  brands,
  packages,
}: {
  actorName: string;
  brands: Brand[];
  packages: AdChangePackageListItem[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tenantId, setTenantId] = useState(brands[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const pending = packages.filter((p) => p.status === "pending");
  const drafts = packages.filter((p) => p.status === "draft" || p.status === "rejected");
  const history = packages.filter(
    (p) => !["pending", "draft", "rejected"].includes(p.status),
  );

  const selected = useMemo(
    () => brands.find((b) => b.id === tenantId) ?? null,
    [brands, tenantId],
  );

  async function postJson(url: string, body: unknown) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) throw new Error(json.error || "İşlem başarısız");
  }

  async function createDraft() {
    if (!selected) return;
    setBusy("create");
    setMessage(null);
    try {
      await postJson("/api/panel/ads-publish/packages", {
        tenantId: selected.id,
        platform: "meta",
        title: title.trim() || `${selected.name} Meta taslağı`,
        adAccountId: selected.metaAccountId,
      });
      setTitle("");
      startTransition(() => router.refresh());
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Kayıt alınamadı");
    } finally {
      setBusy(null);
    }
  }

  async function act(id: string, action: "submit" | "approve" | "reject") {
    setBusy(`${action}:${id}`);
    setMessage(null);
    try {
      await postJson(`/api/panel/ads-publish/packages/${id}`, { action });
      startTransition(() => router.refresh());
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "İşlem başarısız");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Meta yayın</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Reklam seti ve reklam değişiklik paketleri. Meta’ya yazma onaya bağlıdır.
          Erişim: {actorName}.
        </p>
      </div>

      {message ? (
        <p className="text-sm text-[#e91825]" role="status">
          {message}
        </p>
      ) : null}

      <section className="rounded-2xl border border-zinc-200 bg-white p-5">
        <h3 className="text-sm font-semibold">Manuel taslak</h3>
        <p className="mt-1 text-xs text-zinc-500">
          Editör (kreatif, bütçe, hedefleme) sonraki aşamada. Şimdi paket açılır,
          onaya gönderilir; onay iş kuyruğuna düşer.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-zinc-500">Marka</span>
            <select
              className={fieldClass}
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
            >
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-[220px] flex-1 text-sm">
            <span className="mb-1 block text-xs font-medium text-zinc-500">Başlık</span>
            <input
              className={`${fieldClass} w-full`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Örn. Reklam A yeni video varyasyonu"
            />
          </label>
          <button
            type="button"
            className={btnPrimary}
            disabled={!selected || busy === "create"}
            onClick={() => void createDraft()}
          >
            Taslak oluştur
          </button>
        </div>
      </section>

      <PackageGroup
        title="Onay bekleyenler"
        empty="Onay bekleyen paket yok."
        items={pending}
        busy={busy}
        actions={["approve", "reject"]}
        onAct={act}
      />
      <PackageGroup
        title="Taslaklar"
        empty="Taslak yok."
        items={drafts}
        busy={busy}
        actions={["submit"]}
        onAct={act}
      />
      <PackageGroup
        title="İşlem geçmişi"
        empty="Uygulanan veya kuyruğa alınan paket yok."
        items={history}
        busy={busy}
        actions={[]}
        onAct={act}
      />

      <section className="rounded-2xl border border-zinc-200 bg-white p-5">
        <h3 className="text-sm font-semibold">Format ve alan matrisi</h3>
        <p className="mt-1 text-xs text-zinc-500">
          Panel ve backend aynı kuralları kullanır. Bütçe kampanyadaysa reklam seti
          bütçesi kilitlenir.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="py-2 pr-3 font-medium">Format</th>
                <th className="py-2 pr-3 font-medium">Set</th>
                <th className="py-2 pr-3 font-medium">Reklam</th>
                <th className="py-2 pr-3 font-medium">Kreatif değiştir</th>
                <th className="py-2 pr-3 font-medium">Yeni varyasyon</th>
                <th className="py-2 font-medium">Önizleme</th>
              </tr>
            </thead>
            <tbody>
              {META_FORMATS.map((f) => (
                <tr key={f.key} className="border-t border-zinc-100">
                  <td className="py-2 pr-3 font-medium">{f.label}</td>
                  <td className="py-2 pr-3">{f.createAdset ? "Evet" : "—"}</td>
                  <td className="py-2 pr-3">{f.createAd ? "Evet" : "—"}</td>
                  <td className="py-2 pr-3">{f.swapCreative ? "Evet" : "—"}</td>
                  <td className="py-2 pr-3">{f.newVariation ? "Evet" : "—"}</td>
                  <td className="py-2">{f.preview ? "Evet" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="mt-4 grid gap-1.5 text-xs text-zinc-600 sm:grid-cols-2">
          {META_FIELDS.map((f) => (
            <li key={f.key}>
              <span className="font-medium text-zinc-800">{f.label}</span>
              <span className="text-zinc-400"> · {f.level}</span>
              {f.disableIfCampaignBudget ? (
                <span className="text-zinc-400"> · kampanya bütçesi varsa kilitli</span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function PackageGroup({
  title,
  empty,
  items,
  busy,
  actions,
  onAct,
}: {
  title: string;
  empty: string;
  items: AdChangePackageListItem[];
  busy: string | null;
  actions: Array<"submit" | "approve" | "reject">;
  onAct: (id: string, action: "submit" | "approve" | "reject") => void;
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-zinc-400">{items.length}</p>
      </div>
      {items.length === 0 ? (
        <div className="mt-3">
          <EmptyState title={empty} description="Onaylanan paketler kuyruğa alınır; Meta yazımı sonraki aşamada." />
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-zinc-100">
          {items.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{p.title}</p>
                <p className="text-xs text-zinc-500">
                  {p.tenantName} · v{p.currentVersion} · {packageStatusLabel(p.status)}
                  {p.createdByName ? ` · ${p.createdByName}` : ""}
                </p>
              </div>
              {actions.length ? (
                <div className="flex flex-wrap gap-2">
                  {actions.includes("submit") ? (
                    <button
                      type="button"
                      className={btnSecondary}
                      disabled={busy !== null}
                      onClick={() => onAct(p.id, "submit")}
                    >
                      Onaya gönder
                    </button>
                  ) : null}
                  {actions.includes("approve") ? (
                    <button
                      type="button"
                      className={btnPrimary}
                      disabled={busy !== null}
                      onClick={() => onAct(p.id, "approve")}
                    >
                      Onayla ve uygula
                    </button>
                  ) : null}
                  {actions.includes("reject") ? (
                    <button
                      type="button"
                      className={btnSecondary}
                      disabled={busy !== null}
                      onClick={() => onAct(p.id, "reject")}
                    >
                      Reddet
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
