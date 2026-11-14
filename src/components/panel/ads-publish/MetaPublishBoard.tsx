"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/panel/ds/EmptyState";
import {
  btnPrimary,
  btnSecondary,
  chipClass,
  fieldClass,
} from "@/components/panel/ds/buttons";
import type { BrandCreativeTask } from "@/lib/panel/ads-publish/brand-creatives";
import type {
  MetaAdRow,
  MetaAdsCampaignNode,
} from "@/lib/panel/ads-publish/meta-account-ads";
import {
  packageStatusLabel,
  type AdChangeField,
  type AdChangeMedia,
  type AdChangePackageListItem,
} from "@/lib/panel/ads-publish/types";
import type { ApprovalPreview } from "@/lib/panel/ads-publish/approval-preview";

type Brand = { id: string; slug: string; name: string; metaAccountId: string };

type EditorTab = "creative" | "audience" | "placements" | "status";

type EditorState = {
  primaryText: string;
  headline: string;
  description: string;
  cta: string;
  link: string;
  urlTags: string;
  targeting: string;
  placements: string;
  adStatus: string;
  adsetStatus: string;
  dailyBudget: string;
  notes: string;
};

const EMPTY_EDITOR: EditorState = {
  primaryText: "",
  headline: "",
  description: "",
  cta: "",
  link: "",
  urlTags: "",
  targeting: "",
  placements: "",
  adStatus: "",
  adsetStatus: "",
  dailyBudget: "",
  notes: "",
};

export default function MetaPublishBoard({
  actorName,
  brands,
  packages,
  creatives,
  adsByTenant,
  initialBrandId,
  initialCardId,
}: {
  actorName: string;
  brands: Brand[];
  packages: AdChangePackageListItem[];
  creatives: BrandCreativeTask[];
  adsByTenant: Record<
    string,
    { tree: MetaAdsCampaignNode[]; syncedAt: string | null }
  >;
  initialBrandId: string;
  initialCardId: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tenantId, setTenantId] = useState(initialBrandId || brands[0]?.id || "");
  const [tab, setTab] = useState<EditorTab>("creative");
  const [selectedAdId, setSelectedAdId] = useState<string | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(
    initialCardId,
  );
  const [title, setTitle] = useState("");
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [baseline, setBaseline] = useState<EditorState>(EMPTY_EDITOR);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [approvePreview, setApprovePreview] = useState<ApprovalPreview | null>(
    null,
  );

  const selectedBrand = useMemo(
    () => brands.find((b) => b.id === tenantId) ?? null,
    [brands, tenantId],
  );

  const adsBundle = adsByTenant[tenantId] ?? { tree: [], syncedAt: null };
  const brandCreatives = useMemo(
    () => creatives.filter((c) => c.tenantId === tenantId),
    [creatives, tenantId],
  );
  const readyCreatives = brandCreatives.filter((c) => c.readyForAds);
  const openCreatives = brandCreatives.filter((c) => !c.columnDone);

  const flatAds = useMemo(() => {
    const list: MetaAdRow[] = [];
    for (const c of adsBundle.tree) {
      for (const s of c.adsets) list.push(...s.ads);
    }
    return list;
  }, [adsBundle.tree]);

  const selectedAd = flatAds.find((a) => a.adId === selectedAdId) ?? null;
  const selectedCard =
    brandCreatives.find((c) => c.cardId === selectedCardId) ?? null;

  useEffect(() => {
    if (!selectedAdId && flatAds[0]) setSelectedAdId(flatAds[0].adId);
  }, [flatAds, selectedAdId, tenantId]);

  useEffect(() => {
    if (!selectedCardId && readyCreatives[0]) {
      setSelectedCardId(readyCreatives[0].cardId);
    }
  }, [readyCreatives, selectedCardId, tenantId]);

  useEffect(() => {
    const next: EditorState = {
      ...EMPTY_EDITOR,
      link: selectedAd?.linkUrl ?? "",
      urlTags: selectedAd?.urlTags ?? "",
      adStatus: selectedAd?.effectiveStatus || selectedAd?.status || "",
    };
    setEditor(next);
    setBaseline(next);
    if (selectedAd) {
      setTitle(
        `${selectedBrand?.name ?? "Marka"} · ${selectedAd.adName || selectedAd.adId}`,
      );
    }
  }, [selectedAd?.adId, selectedBrand?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedCard) return;
    const thumb = selectedCard.images[0];
    if (thumb) {
      setEditor((e) => ({ ...e }));
    }
  }, [selectedCard?.cardId]); // eslint-disable-line react-hooks/exhaustive-deps

  const brandPackages = packages.filter((p) => p.tenantId === tenantId);
  const pending = brandPackages.filter((p) => p.status === "pending");
  const drafts = brandPackages.filter(
    (p) => p.status === "draft" || p.status === "rejected",
  );
  const history = brandPackages.filter(
    (p) => !["pending", "draft", "rejected"].includes(p.status),
  );

  function setField<K extends keyof EditorState>(key: K, value: EditorState[K]) {
    setEditor((prev) => ({ ...prev, [key]: value }));
  }

  function buildChanges(): AdChangeField[] {
    const pairs: Array<{ field: string; label: string; key: keyof EditorState }> =
      [
        { field: "creative.primary_text", label: "Ana metin", key: "primaryText" },
        { field: "creative.headline", label: "Başlık", key: "headline" },
        { field: "creative.description", label: "Açıklama", key: "description" },
        { field: "creative.cta", label: "CTA", key: "cta" },
        { field: "creative.link", label: "Hedef URL", key: "link" },
        { field: "creative.url_tags", label: "UTM", key: "urlTags" },
        { field: "adset.targeting", label: "Hedefleme", key: "targeting" },
        { field: "adset.placements", label: "Yerleşimler", key: "placements" },
        { field: "ad.status", label: "Reklam durumu", key: "adStatus" },
        { field: "adset.status", label: "Reklam seti durumu", key: "adsetStatus" },
        {
          field: "adset.daily_budget",
          label: "Günlük bütçe",
          key: "dailyBudget",
        },
      ];
    const changes: AdChangeField[] = [];
    for (const p of pairs) {
      const proposed = editor[p.key].trim();
      const current = baseline[p.key].trim();
      if (!proposed || proposed === current) continue;
      changes.push({
        field: p.field,
        label: p.label,
        current: current || null,
        proposed,
      });
    }
    if (selectedCard?.images[0]) {
      const url = selectedCard.images[0];
      const currentMedia = selectedAd?.imageUrl || selectedAd?.thumbnailUrl || null;
      if (url !== currentMedia) {
        changes.push({
          field: "creative.media",
          label: "Görsel / video",
          current: currentMedia,
          proposed: url,
        });
      }
    }
    return changes;
  }

  function buildMedia(): AdChangeMedia[] {
    if (!selectedCard?.images.length) return [];
    return selectedCard.images.map((url, i) => ({
      kind: /\.(mp4|mov|webm)(\?|$)/i.test(url) ? "video" : "image",
      name: `${selectedCard.title}${i ? ` ${i + 1}` : ""}`,
      url,
    }));
  }

  async function postJson(url: string, body: unknown) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { error?: string; package?: AdChangePackageListItem };
    if (!res.ok) throw new Error(json.error || "İşlem başarısız");
    return json;
  }

  async function saveDraft(andSubmit: boolean) {
    if (!selectedBrand) return;
    const changes = buildChanges();
    if (changes.length === 0 && !selectedCard) {
      setMessage("En az bir alan değiştirin veya hazır kreatif seçin.");
      return;
    }
    setBusy(andSubmit ? "submit" : "save");
    setMessage(null);
    try {
      const created = await postJson("/api/panel/ads-publish/packages", {
        tenantId: selectedBrand.id,
        platform: "meta",
        title: title.trim() || `${selectedBrand.name} Meta değişikliği`,
        adAccountId: selectedBrand.metaAccountId,
        campaignId: selectedAd?.campaignId,
        adsetId: selectedAd?.adsetId,
        adId: selectedAd?.adId,
        changes,
        media: buildMedia(),
        notes: editor.notes.trim(),
        source: selectedCard
          ? {
              boardCardId: selectedCard.cardId,
              contentPostId: selectedCard.contentPostId ?? undefined,
              cardTitle: selectedCard.title,
            }
          : undefined,
      });
      if (andSubmit && created.package) {
        await postJson(`/api/panel/ads-publish/packages/${created.package.id}`, {
          action: "submit",
        });
      }
      startTransition(() => router.refresh());
      setMessage(
        andSubmit
          ? "Paket onaya gönderildi."
          : "Taslak kaydedildi. Meta yazımı onaydan sonra uygulanır.",
      );
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
      if (action === "approve") {
        const res = await fetch(
          `/api/panel/ads-publish/packages/${id}?preview=1`,
        );
        const json = (await res.json()) as {
          error?: string;
          preview?: ApprovalPreview;
        };
        if (!res.ok || !json.preview) {
          throw new Error(json.error || "Önizleme alınamadı");
        }
        setApprovePreview(json.preview);
        setBusy(null);
        return;
      }
      await postJson(`/api/panel/ads-publish/packages/${id}`, { action });
      startTransition(() => router.refresh());
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "İşlem başarısız");
    } finally {
      setBusy(null);
    }
  }

  async function confirmApprove() {
    if (!approvePreview) return;
    setBusy(`approve:${approvePreview.packageId}`);
    setMessage(null);
    try {
      await postJson(
        `/api/panel/ads-publish/packages/${approvePreview.packageId}`,
        {
          action: "approve",
          previewFingerprint: approvePreview.fingerprint,
        },
      );
      setApprovePreview(null);
      startTransition(() => router.refresh());
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Onay başarısız");
    } finally {
      setBusy(null);
    }
  }

  function switchBrand(id: string) {
    setTenantId(id);
    setSelectedAdId(null);
    setSelectedCardId(null);
    setMessage(null);
    const brand = brands.find((b) => b.id === id);
    if (brand) {
      const qs = new URLSearchParams({ brand: brand.slug });
      startTransition(() => router.replace(`/meta-yayin?${qs.toString()}`));
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Meta yayın</h2>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500">
            Marka hesabındaki reklamları seç, kreatif / hedef kitle / yerleşim
            değişikliklerini paketle. Meta’ya yazma onaya bağlıdır · {actorName}
          </p>
        </div>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-zinc-500">Marka</span>
          <select
            className={`${fieldClass} min-w-[220px]`}
            value={tenantId}
            onChange={(e) => switchBrand(e.target.value)}
          >
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      </header>

      {message ? (
        <p className="text-sm text-[#e91825]" role="status">
          {message}
        </p>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.25fr)]">
        {/* Sol: reklam ağacı + kreatifler */}
        <div className="space-y-4">
          <section className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold">Hesap reklamları</h3>
              <p className="text-[11px] text-zinc-400">
                {adsBundle.syncedAt
                  ? `Sync ${new Date(adsBundle.syncedAt).toLocaleString("tr-TR")}`
                  : "Henüz sync yok"}
              </p>
            </div>
            {adsBundle.tree.length === 0 ? (
              <div className="mt-3">
                <EmptyState
                  title="Bu markada Meta reklam snapshot’ı yok"
                  description="Markalar sayfasından Meta senkronu çalıştırınca kampanya / set / reklam burada listelenir."
                />
              </div>
            ) : (
              <div className="mt-3 max-h-[420px] space-y-3 overflow-y-auto pr-1">
                {adsBundle.tree.map((camp) => (
                  <div key={camp.campaignId}>
                    <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                      {camp.campaignName}
                    </p>
                    <ul className="mt-1.5 space-y-2">
                      {camp.adsets.map((set) => (
                        <li key={set.adsetId}>
                          <p className="truncate text-xs text-zinc-600">
                            {set.adsetName}
                          </p>
                          <ul className="mt-1 space-y-1">
                            {set.ads.map((ad) => {
                              const active = ad.adId === selectedAdId;
                              const thumb = ad.thumbnailUrl || ad.imageUrl;
                              return (
                                <button
                                  key={ad.adId}
                                  type="button"
                                  onClick={() => setSelectedAdId(ad.adId)}
                                  className={`flex w-full items-center gap-2 rounded-xl border px-2 py-1.5 text-left transition ${
                                    active
                                      ? "border-[#141111] bg-zinc-50"
                                      : "border-transparent hover:border-zinc-200 hover:bg-zinc-50"
                                  }`}
                                >
                                  <span className="relative size-9 shrink-0 overflow-hidden rounded-lg bg-zinc-100">
                                    {thumb ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        src={thumb}
                                        alt=""
                                        className="size-full object-cover"
                                      />
                                    ) : null}
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-medium text-zinc-900">
                                      {ad.adName}
                                    </span>
                                    <span className="block truncate text-[11px] text-zinc-500">
                                      {ad.effectiveStatus || ad.status || "—"}
                                    </span>
                                  </span>
                                </button>
                              );
                            })}
                          </ul>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold">Durum panosu kreatifleri</h3>
              <p className="text-[11px] text-zinc-400">
                {readyCreatives.length} hazır · {openCreatives.length} açık
              </p>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              Grafik görevi tamamlanınca veya görsel eklenince buradan reklama
              alınır.
            </p>
            {brandCreatives.length === 0 ? (
              <div className="mt-3">
                <EmptyState
                  title="Bu markaya bağlı tasarım görevi yok"
                  description="Durum panosunda markalı grafik kartı veya takvimden tasarım görevi açıldığında burada görünür."
                />
              </div>
            ) : (
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {brandCreatives.map((c) => {
                  const active = c.cardId === selectedCardId;
                  const thumb = c.images[0];
                  return (
                    <li key={c.cardId}>
                      <button
                        type="button"
                        onClick={() => setSelectedCardId(c.cardId)}
                        className={`flex w-full gap-2 rounded-xl border p-2 text-left transition ${
                          active
                            ? "border-[#141111] bg-zinc-50"
                            : "border-zinc-200 hover:border-zinc-300"
                        }`}
                      >
                        <span className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-zinc-100">
                          {thumb ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={thumb}
                              alt=""
                              className="size-full object-cover"
                            />
                          ) : (
                            <span className="flex size-full items-center justify-center text-[10px] text-zinc-400">
                              yok
                            </span>
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {c.title}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-zinc-500">
                            {c.columnName}
                            {c.readyForAds ? " · reklama hazır" : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {/* Sağ: editör */}
        <section className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">Değişiklik editörü</h3>
              <p className="mt-1 text-xs text-zinc-500">
                {selectedAd
                  ? `${selectedAd.campaignName} → ${selectedAd.adsetName} → ${selectedAd.adName}`
                  : "Soldan bir reklam seçin"}
              </p>
            </div>
            {selectedAd?.permalinkUrl ? (
              <a
                href={selectedAd.permalinkUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-[#e91825] hover:underline"
              >
                Meta önizleme
              </a>
            ) : null}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {(
              [
                ["creative", "Kreatif"],
                ["audience", "Hedef kitle"],
                ["placements", "Yerleşim"],
                ["status", "Durum / bütçe"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={chipClass(tab === key)}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>

          <label className="mt-4 block text-sm">
            <span className="mb-1 block text-xs font-medium text-zinc-500">
              Paket başlığı
            </span>
            <input
              className={`${fieldClass} w-full rounded-xl`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Örn. Kreatif swap — yaz koleksiyonu"
            />
          </label>

          <div className="mt-4 space-y-3">
            {tab === "creative" ? (
              <>
                {selectedCard ? (
                  <div className="flex items-center gap-3 rounded-xl border border-zinc-100 bg-zinc-50 p-3">
                    <span className="relative size-12 overflow-hidden rounded-lg bg-zinc-200">
                      {selectedCard.images[0] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={selectedCard.images[0]}
                          alt=""
                          className="size-full object-cover"
                        />
                      ) : null}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        Seçili kreatif: {selectedCard.title}
                      </p>
                      <p className="text-[11px] text-zinc-500">
                        Durum panosundan · {selectedCard.columnName}
                      </p>
                    </div>
                  </div>
                ) : null}
                <Field
                  label="Ana metin"
                  value={editor.primaryText}
                  onChange={(v) => setField("primaryText", v)}
                  multiline
                />
                <Field
                  label="Başlık"
                  value={editor.headline}
                  onChange={(v) => setField("headline", v)}
                />
                <Field
                  label="Açıklama"
                  value={editor.description}
                  onChange={(v) => setField("description", v)}
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="CTA"
                    value={editor.cta}
                    onChange={(v) => setField("cta", v)}
                    placeholder="LEARN_MORE, SHOP_NOW…"
                  />
                  <Field
                    label="Hedef URL"
                    value={editor.link}
                    onChange={(v) => setField("link", v)}
                  />
                </div>
                <Field
                  label="UTM / url_tags"
                  value={editor.urlTags}
                  onChange={(v) => setField("urlTags", v)}
                />
              </>
            ) : null}

            {tab === "audience" ? (
              <Field
                label="Hedef kitle (özet / JSON / not)"
                value={editor.targeting}
                onChange={(v) => setField("targeting", v)}
                multiline
                placeholder="Yaş, konum, ilgi alanları, özel kitle… Meta yazımında yapılandırılmış hedeflemeye çevrilecek."
              />
            ) : null}

            {tab === "placements" ? (
              <Field
                label="Yerleşimler"
                value={editor.placements}
                onChange={(v) => setField("placements", v)}
                multiline
                placeholder="Feed, Stories, Reels, Audience Network… veya automatic."
              />
            ) : null}

            {tab === "status" ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="Reklam durumu"
                    value={editor.adStatus}
                    onChange={(v) => setField("adStatus", v)}
                    placeholder="ACTIVE / PAUSED"
                  />
                  <Field
                    label="Reklam seti durumu"
                    value={editor.adsetStatus}
                    onChange={(v) => setField("adsetStatus", v)}
                    placeholder="ACTIVE / PAUSED"
                  />
                </div>
                <Field
                  label="Günlük bütçe (TRY)"
                  value={editor.dailyBudget}
                  onChange={(v) => setField("dailyBudget", v)}
                />
              </>
            ) : null}

            <Field
              label="Not / gerekçe"
              value={editor.notes}
              onChange={(v) => setField("notes", v)}
              multiline
              placeholder="Neden değiştiriyoruz? Onay ekranında görünür."
            />
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              className={btnSecondary}
              disabled={!selectedBrand || busy !== null}
              onClick={() => void saveDraft(false)}
            >
              Taslak kaydet
            </button>
            <button
              type="button"
              className={btnPrimary}
              disabled={!selectedBrand || busy !== null}
              onClick={() => void saveDraft(true)}
            >
              Onaya gönder
            </button>
          </div>
          <p className="mt-2 text-[11px] text-zinc-400">
            Değişen alanlar: {buildChanges().length}. Meta API yazımı onay + kuyruk
            sonrası (sonraki aşama).
          </p>
        </section>
      </div>

      {approvePreview ? (
        <ApprovalPreviewModal
          preview={approvePreview}
          busy={busy !== null}
          onCancel={() => setApprovePreview(null)}
          onConfirm={() => void confirmApprove()}
        />
      ) : null}

      <PackageGroup
        title="Onay bekleyenler"
        empty="Bu markada onay bekleyen paket yok."
        items={pending}
        busy={busy}
        actions={["approve", "reject"]}
        onAct={act}
      />
      <PackageGroup
        title="Taslaklar"
        empty="Bu markada taslak yok."
        items={drafts}
        busy={busy}
        actions={["submit"]}
        onAct={act}
      />
      <PackageGroup
        title="İşlem geçmişi"
        empty="Uygulanan paket yok."
        items={history}
        busy={busy}
        actions={[]}
        onAct={act}
      />
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  multiline,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium text-zinc-500">{label}</span>
      {multiline ? (
        <textarea
          className="min-h-[88px] w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-[#141111] placeholder:text-zinc-400 focus:border-[#141111] focus:outline-none"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <input
          className={`${fieldClass} w-full rounded-xl`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
    </label>
  );
}

function ApprovalPreviewModal({
  preview,
  busy,
  onCancel,
  onConfirm,
}: {
  preview: ApprovalPreview;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = preview.target;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="approve-preview-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl"
      >
        <h3 id="approve-preview-title" className="text-base font-semibold">
          Onay önizlemesi
        </h3>
        <p className="mt-1 text-sm text-zinc-500">
          {preview.tenantName} · {preview.title} · v{preview.version}
        </p>
        <dl className="mt-4 space-y-2 text-sm">
          <div>
            <dt className="text-xs font-medium text-zinc-500">Kampanya</dt>
            <dd className="font-medium text-zinc-900">
              {t.campaignName || "—"}{" "}
              <span className="font-mono text-xs text-zinc-500">
                {t.campaignId || "yok"}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-zinc-500">Reklam seti</dt>
            <dd className="font-medium text-zinc-900">
              {t.adsetName || "—"}{" "}
              <span className="font-mono text-xs text-zinc-500">
                {t.adsetId || "yok"}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-zinc-500">Reklam</dt>
            <dd className="font-medium text-zinc-900">
              {t.adName || "—"}{" "}
              <span className="font-mono text-xs text-zinc-500">
                {t.adId || "yok"}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-zinc-500">Etki</dt>
            <dd>
              {preview.impact.adsetCount} set · {preview.impact.adCount} reklam
            </dd>
          </div>
        </dl>
        <ul className="mt-4 divide-y divide-zinc-100 rounded-xl border border-zinc-100">
          {preview.changes.map((c) => (
            <li key={c.field} className="px-3 py-2 text-sm">
              <p className="font-medium text-zinc-900">{c.label}</p>
              {c.budget ? (
                <p className="mt-0.5 text-zinc-600">
                  {c.budget.currentMajor ?? "—"} → {c.budget.proposedMajor ?? "—"}{" "}
                  TRY/gün
                </p>
              ) : (
                <p className="mt-0.5 text-zinc-600">
                  <span className="text-zinc-400">{String(c.current ?? "—")}</span>
                  {" → "}
                  <span>{String(c.proposed ?? "—")}</span>
                </p>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className={btnSecondary}
            disabled={busy}
            onClick={onCancel}
          >
            Vazgeç
          </button>
          <button
            type="button"
            className={btnPrimary}
            disabled={busy}
            onClick={onConfirm}
          >
            Onayla ve uygula
          </button>
        </div>
      </div>
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
          <EmptyState
            title={empty}
            description="Onaylanan paketler kuyruğa alınır; Meta yazımı sonraki aşamada."
          />
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-zinc-100">
          {items.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{p.title}</p>
                <p className="text-xs text-zinc-500">
                  {p.tenantName} · v{p.currentVersion} ·{" "}
                  {p.isStuck ? "Takıldı" : packageStatusLabel(p.status)}
                  {p.createdByName ? ` · ${p.createdByName}` : ""}
                </p>
                {p.outcomeNote ? (
                  <p className="mt-0.5 text-xs text-amber-700">{p.outcomeNote}</p>
                ) : null}
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
                      Onayla
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
