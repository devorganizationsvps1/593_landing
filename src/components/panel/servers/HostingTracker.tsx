"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { HostingRow } from "@/lib/servers/hosting";
import { BTN, BTN_QUIET, BTN_SOLID, FIELD, FRAME, LABEL, Status, fmtDate, fmtDateShort, post, type Tone } from "./ui";

/** 30 gün ve altı "yaklaşıyor" sayılır. */
const SOON_DAYS = 30;

function stateOf(r: HostingRow): { tone: Tone; label: string; fill: string } {
  if (r.daysLeft <= 0) {
    return {
      tone: "critical",
      label: r.daysLeft === 0 ? "Süre bugün doldu" : `Süre ${-r.daysLeft} gün önce doldu`,
      fill: "#e91825",
    };
  }
  if (r.daysLeft <= SOON_DAYS) return { tone: "warn", label: `${r.daysLeft} gün kaldı`, fill: "#b45309" };
  return { tone: "ok", label: `${r.daysLeft} gün kaldı`, fill: "#141111" };
}

/**
 * Yıl çubuğu: 12 aylık dilim, dönemde geçen gün kadar dolar. Dilimler arası
 * boşluk ay sınırını gösterir; renk durumu (yazıyla birlikte) taşır.
 */
function YearBar({ row }: { row: HostingRow }) {
  const { fill } = stateOf(row);
  const done = (row.elapsedDays / row.totalDays) * 12;
  return (
    <div
      className="flex h-3 gap-[2px]"
      role="meter"
      aria-label={`${row.name} hosting dönemi`}
      aria-valuemin={0}
      aria-valuemax={row.totalDays}
      aria-valuenow={row.elapsedDays}
      aria-valuetext={`${row.totalDays} günün ${row.elapsedDays} günü geçti`}
    >
      {Array.from({ length: 12 }, (_, i) => (
        <span key={i} className="flex-1 overflow-hidden bg-[#e7e5e4] first:rounded-l-sm last:rounded-r-sm">
          <span className="block h-full" style={{ width: `${Math.min(1, Math.max(0, done - i)) * 100}%`, background: fill }} />
        </span>
      ))}
    </div>
  );
}

function money(v: number | null, currency: string): string {
  return v == null ? "—" : `${v.toLocaleString("tr-TR")} ${currency}`;
}

function EditForm({ row, onDone }: { row: HostingRow; onDone: (saved: boolean) => void }) {
  const [form, setForm] = useState({
    paidUntil: row.periodEnd,
    yearlyFee: row.yearlyFee?.toString() ?? "",
    currency: row.currency,
    note: row.note ?? "",
    hidden: row.hidden,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const r = await post({ op: "hostingSave", key: row.key, name: row.name, hosting: form });
    setSaving(false);
    if (!r.ok) return setError(String(r.data.error ?? "Kaydedilemedi"));
    onDone(true);
  }

  return (
    <form onSubmit={save} className="grid gap-4 border-t border-panel-border bg-panel-surface-muted px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className={LABEL}>
        Dönem bitiş tarihi
        <input
          type="date"
          required
          value={form.paidUntil}
          onChange={(e) => setForm((f) => ({ ...f, paidUntil: e.target.value }))}
          className={`${FIELD} mt-1`}
        />
      </label>
      <label className={LABEL}>
        Yıllık ücret
        <span className="mt-1 flex gap-2">
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.yearlyFee}
            onChange={(e) => setForm((f) => ({ ...f, yearlyFee: e.target.value }))}
            className={FIELD}
          />
          <select
            value={form.currency}
            onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
            className={`${FIELD} w-24`}
            aria-label="Para birimi"
          >
            {["TRY", "USD", "EUR"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </span>
      </label>
      <label className={`${LABEL} lg:col-span-2`}>
        Not
        <input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} className={`${FIELD} mt-1`} />
      </label>
      <label className="flex items-center gap-2 text-[13px] text-panel-fg sm:col-span-2">
        <input
          type="checkbox"
          className="size-4 accent-[#141111]"
          checked={form.hidden}
          onChange={(e) => setForm((f) => ({ ...f, hidden: e.target.checked }))}
        />
        Takip etme (ajansın kendi sitesi, deneme projesi)
      </label>
      <div className="flex items-center gap-2 sm:col-span-2 lg:justify-end">
        {error ? <p className="mr-auto text-[13px] text-panel-critical">{error}</p> : null}
        <button type="button" onClick={() => onDone(false)} className={BTN_QUIET}>
          Vazgeç
        </button>
        <button type="submit" disabled={saving} className={BTN_SOLID}>
          {saving ? "Kaydediliyor…" : "Kaydet"}
        </button>
      </div>
    </form>
  );
}

export default function HostingTracker({ rows }: { rows: HostingRow[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const refresh = () => startTransition(() => router.refresh());

  const tracked = rows.filter((r) => !r.hidden);
  const hidden = rows.filter((r) => r.hidden);
  const due = tracked.filter((r) => r.daysLeft <= 0);
  const soon = tracked.filter((r) => r.daysLeft > 0 && r.daysLeft <= SOON_DAYS);
  const visible = showHidden ? rows : tracked;

  async function paid(r: HostingRow) {
    const ok = confirm(
      `${r.name} için hosting ödemesi alındı olarak işaretlensin mi?\n\nDönem bir yıl ileri alınır: yeni bitiş ${fmtDate(
        new Date(Date.UTC(Number(r.periodEnd.slice(0, 4)) + 1, Number(r.periodEnd.slice(5, 7)) - 1, Number(r.periodEnd.slice(8, 10)))).toISOString(),
      )}.`,
    );
    if (!ok) return;
    setBusy(r.key);
    setError(null);
    const res = await post({ op: "hostingPaid", key: r.key, name: r.name });
    setBusy(null);
    if (!res.ok) setError(String(res.data.error ?? "İşaretlenemedi"));
    refresh();
  }

  return (
    <section className={FRAME}>
      <header className="flex flex-wrap items-end justify-between gap-4 px-5 py-5">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-panel-fg">Hosting takibi</h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-5 text-panel-fg-secondary">
            Her firmanın bir yıllık hosting dönemi. Çubuk, dönemde geçen gün kadar dolar; dolduğunda firmadan yenileme
            ücreti istenir.
          </p>
        </div>
        <p className="text-[13px] text-panel-fg">
          {due.length ? <span className="font-semibold text-panel-critical">{due.length} firmanın süresi doldu</span> : null}
          {due.length && soon.length ? ", " : ""}
          {soon.length ? (
            <span className="font-semibold text-panel-warn">
              {soon.length} firmanın {SOON_DAYS} günden az kaldı
            </span>
          ) : null}
          {!due.length && !soon.length ? "Yaklaşan yenileme yok" : ""}
        </p>
      </header>

      {error ? (
        <p role="alert" className="border-t border-panel-border bg-panel-critical-bg px-5 py-2 text-[13px] text-panel-critical">
          {error}
        </p>
      ) : null}

      {visible.length === 0 ? (
        <p className="border-t border-panel-border px-5 py-8 text-[13px] text-panel-fg-secondary">
          Dokploy&apos;da proje bulunamadı. Proje eklendiğinde burada kendiliğinden görünür.
        </p>
      ) : (
        <ul>
          {visible.map((r) => {
            const st = stateOf(r);
            return (
              <li key={r.key} className={`border-t border-panel-border ${r.hidden ? "opacity-60" : ""}`}>
                <div className="grid items-center gap-x-6 gap-y-3 px-5 py-4 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_11rem_auto]">
                  <div className="min-w-0">
                    <h3 className="truncate text-[15px] font-semibold text-panel-fg">{r.name}</h3>
                    <p className="truncate text-[13px] text-panel-fg-secondary">{r.domain ?? r.serverName}</p>
                  </div>

                  <div className="min-w-0">
                    <YearBar row={r} />
                    <div className="mt-1.5 flex justify-between text-[12px] tabular-nums text-panel-fg-secondary">
                      <span>{fmtDateShort(r.periodStart)}</span>
                      <span className="font-medium text-panel-fg">
                        {r.elapsedDays} / {r.totalDays} gün
                      </span>
                      <span>{fmtDateShort(r.periodEnd)}</span>
                    </div>
                  </div>

                  <div>
                    <Status tone={st.tone}>{r.hidden ? "Takip edilmiyor" : st.label}</Status>
                    <p className="mt-0.5 text-[13px] tabular-nums text-panel-fg-secondary">{money(r.yearlyFee, r.currency)}</p>
                  </div>

                  <div className="flex gap-2 lg:justify-end">
                    {!r.hidden && r.daysLeft <= SOON_DAYS ? (
                      <button type="button" onClick={() => paid(r)} disabled={busy !== null} className={BTN_SOLID}>
                        {busy === r.key ? "İşleniyor…" : "Ödeme alındı"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setEditing(editing === r.key ? null : r.key)}
                      aria-expanded={editing === r.key}
                      className={BTN}
                    >
                      Düzenle
                    </button>
                  </div>
                </div>
                {r.note && editing !== r.key ? (
                  <p className="-mt-2 px-5 pb-4 text-[13px] text-panel-fg-secondary">{r.note}</p>
                ) : null}
                {editing === r.key ? (
                  <EditForm
                    row={r}
                    onDone={(saved) => {
                      setEditing(null);
                      if (saved) refresh();
                    }}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {hidden.length ? (
        <footer className="border-t border-panel-border px-5 py-3">
          <button type="button" onClick={() => setShowHidden((v) => !v)} className={BTN_QUIET}>
            {showHidden ? "Takip edilmeyenleri gizle" : `Takip edilmeyen ${hidden.length} projeyi göster`}
          </button>
        </footer>
      ) : null}
    </section>
  );
}
