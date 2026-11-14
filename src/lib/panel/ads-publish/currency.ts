/**
 * Meta hesap para birimi vs panel Tenant.currency.
 * Bütçe adımları yalnızca uyuşunca (veya meta henüz okunmadıysa — uyarı).
 */

export function normalizeCurrency(raw: string | null | undefined): string {
  return (raw || "").trim().toUpperCase();
}

/** Her ikisi dolu ve farklıysa true. */
export function currenciesMismatch(
  tenantCurrency: string | null | undefined,
  metaCurrency: string | null | undefined,
): boolean {
  const t = normalizeCurrency(tenantCurrency);
  const m = normalizeCurrency(metaCurrency);
  if (!t || !m) return false;
  return t !== m;
}

export function currencyMismatchMessage(
  tenantCurrency: string,
  metaCurrency: string,
): string {
  return (
    `Para birimi uyuşmuyor: panel ${normalizeCurrency(tenantCurrency)}, ` +
    `Meta hesap ${normalizeCurrency(metaCurrency)}. ` +
    `Bütçe düzenleme engellendi — durum değişiklikleri etkilenmez. ` +
    `Tenant.currency’yi Meta hesabıyla eşleştirin veya sync’i doğrulayın.`
  );
}

/** Önizleme / bütçe gösterimi: Meta hesabı varsa onu, yoksa tenant. */
export function resolveBudgetDisplayCurrency(opts: {
  tenantCurrency?: string | null;
  metaCurrency?: string | null;
}): string {
  const m = normalizeCurrency(opts.metaCurrency);
  if (m) return m;
  return normalizeCurrency(opts.tenantCurrency) || "TRY";
}
