"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Link2, Link2Off, Loader2 } from "lucide-react";
import { btnPrimary, btnSecondary, fieldClass } from "@/components/panel/ds/buttons";
import {
  PUBLISHER_READY,
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_LABEL,
  type SocialPlatformKey,
} from "@/lib/social/formats";
import type { MetaPageOption } from "@/lib/social/meta";
import type { SerializedSocialAccount } from "@/lib/social/state";

/**
 * Marka → sosyal hesaplar (otomatik paylaşım). Meta: system user'a atanmış
 * sayfalardan seçilir; Instagram sayfaya bağlıysa birlikte gelir.
 */
export default function BrandSocialAccounts({
  tenantSlug,
  initial,
  canEdit,
}: {
  tenantSlug: string;
  initial: SerializedSocialAccount[];
  canEdit: boolean;
}) {
  const [accounts, setAccounts] = useState(initial);
  const [pages, setPages] = useState<MetaPageOption[] | null>(null);
  const [missingScopes, setMissingScopes] = useState<string[] | null>(null);
  const [pageId, setPageId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const byPlatform = new Map(accounts.map((a) => [a.platform, a]));

  async function loadPages() {
    setBusy("pages");
    setError(null);
    try {
      const res = await fetch("/api/panel/social/meta/pages");
      const json = (await res.json()) as { pages?: MetaPageOption[]; missingScopes?: string[] | null; error?: string };
      if (!res.ok) throw new Error(json.error || "Sayfalar alınamadı");
      setPages(json.pages ?? []);
      setMissingScopes(json.missingScopes ?? null);
      const current = byPlatform.get("facebook")?.externalId;
      setPageId(current && json.pages?.some((p) => p.pageId === current) ? current : "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sayfalar alınamadı");
    } finally {
      setBusy(null);
    }
  }

  async function connectMeta() {
    if (!pageId) return;
    setBusy("connect");
    setError(null);
    try {
      const res = await fetch(`/api/panel/tenants/${tenantSlug}/social-accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "meta", pageId }),
      });
      const json = (await res.json()) as { accounts?: SerializedSocialAccount[]; error?: string };
      if (!res.ok) throw new Error(json.error || "Bağlanamadı");
      setAccounts(json.accounts ?? []);
      setPages(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bağlanamadı");
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(platform: SocialPlatformKey) {
    if (!confirm(`${SOCIAL_PLATFORM_LABEL[platform]} bağlantısı kaldırılsın mı? Bekleyen paylaşımlar hata verir.`)) return;
    setBusy(platform);
    setError(null);
    try {
      const res = await fetch(`/api/panel/tenants/${tenantSlug}/social-accounts?platform=${platform}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as { accounts?: SerializedSocialAccount[]; error?: string };
      if (!res.ok) throw new Error(json.error || "Kaldırılamadı");
      setAccounts(json.accounts ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kaldırılamadı");
    } finally {
      setBusy(null);
    }
  }

  const selected = pages?.find((p) => p.pageId === pageId);

  return (
    <section id="sosyal-hesaplar" className="scroll-mt-20 space-y-4 rounded-xl border border-zinc-200 bg-white p-4 sm:p-5">
      <div>
        <h3 className="text-base font-semibold text-[#141111]">Sosyal hesaplar</h3>
        <p className="mt-1 text-sm text-zinc-500">
          İçerik takviminden otomatik paylaşım yapılacak hesaplar. Meta sayfası BM&apos;de system user&apos;a
          atanmış olmalı; bağlı Instagram profesyonel hesabı birlikte eklenir.
        </p>
      </div>
      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {SOCIAL_PLATFORMS.map((p) => {
          const a = byPlatform.get(p);
          const ready = PUBLISHER_READY[p];
          return (
            <li key={p} className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-[#141111]">{SOCIAL_PLATFORM_LABEL[p]}</p>
                {a ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                    <CheckCircle2 className="size-3.5" aria-hidden />
                    Bağlı
                  </span>
                ) : ready ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-semibold text-zinc-600">
                    <Link2Off className="size-3.5" aria-hidden />
                    Bağlı değil
                  </span>
                ) : (
                  <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-semibold text-zinc-500">Yakında</span>
                )}
              </div>
              {a ? (
                <div className="flex min-w-0 items-center gap-2">
                  {a.pictureUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.pictureUrl} alt="" className="size-8 shrink-0 rounded-full bg-zinc-100 object-cover" />
                  ) : null}
                  <div className="min-w-0">
                    <p className="truncate text-sm text-[#141111]">{a.name}</p>
                    <p className="truncate text-xs text-zinc-500">{a.username ? `@${a.username}` : a.externalId}</p>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-zinc-500">
                  {ready
                    ? p === "instagram"
                      ? "Facebook sayfasıyla birlikte bağlanır."
                      : "Aşağıdan Meta sayfası seçin."
                    : "OAuth bağlantısı sonraki aşamada."}
                </p>
              )}
              {a?.lastError ? (
                <p className="flex items-start gap-1 text-xs text-rose-700">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  {a.lastError}
                </p>
              ) : null}
              {a && canEdit ? (
                <button
                  type="button"
                  className="mt-auto self-start text-xs font-semibold text-rose-600 hover:underline disabled:opacity-50"
                  disabled={busy !== null}
                  onClick={() => disconnect(p)}
                >
                  Bağlantıyı kaldır
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>

      {canEdit ? (
        <div className="space-y-3 rounded-xl border border-dashed border-zinc-300 p-4">
          {pages === null ? (
            <button type="button" className={btnSecondary} disabled={busy !== null} onClick={loadPages}>
              {busy === "pages" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Link2 className="size-4" aria-hidden />}
              {byPlatform.has("facebook") ? "Meta sayfasını değiştir" : "Meta sayfası bağla"}
            </button>
          ) : (
            <>
              {missingScopes && missingScopes.length ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  System user token&apos;ında yayın izinleri eksik: <span className="font-mono">{missingScopes.join(", ")}</span>.
                  Token&apos;ı bu izinlerle yeniden oluşturmadan paylaşım yapılamaz.
                </p>
              ) : null}
              {pages.length === 0 ? (
                <p className="text-sm text-zinc-600">System user&apos;a atanmış sayfa bulunamadı.</p>
              ) : (
                <div className="flex flex-wrap items-end gap-2">
                  <label className="min-w-64 flex-1 text-xs text-zinc-600">
                    Facebook sayfası
                    <select className={`${fieldClass} mt-1 w-full`} value={pageId} onChange={(e) => setPageId(e.target.value)}>
                      <option value="">Seçin</option>
                      {pages.map((p) => (
                        <option key={p.pageId} value={p.pageId} disabled={!p.canPost}>
                          {p.pageName}
                          {p.instagram ? ` · IG @${p.instagram.username ?? p.instagram.id}` : " · IG yok"}
                          {p.canPost ? "" : " (içerik yetkisi yok)"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className={btnPrimary} disabled={!pageId || busy !== null} onClick={connectMeta}>
                    {busy === "connect" ? "Bağlanıyor…" : "Bağla"}
                  </button>
                  <button type="button" className={btnSecondary} disabled={busy !== null} onClick={() => setPages(null)}>
                    Vazgeç
                  </button>
                </div>
              )}
              {selected && !selected.instagram ? (
                <p className="text-xs text-zinc-500">
                  Bu sayfaya bağlı Instagram profesyonel hesabı yok — yalnızca Facebook bağlanır.
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
