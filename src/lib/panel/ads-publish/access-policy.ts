/**
 * Saf allowlist politikası — Next/auth bağımlılığı yok (test edilebilir).
 * Şimdilik yalnızca Muhammet (ads-publish, meta-yayın, sahipsiz, google-analiz,
 * marka detay Performans sekmesi / insights API).
 */
export const ADS_PUBLISH_PEOPLE = ["Muhammet"] as const;

function normTr(value: string): string {
  return value.trim().toLocaleLowerCase("tr");
}

function firstName(value: string): string {
  return normTr(value).split(/\s+/)[0] ?? "";
}

/** Admin bypass yok — yalnızca allowlist (isim veya e-posta local-part). */
export function canAccessAdsPublish(
  person: { name?: string | null; email?: string | null; role?: string | null } | null,
): boolean {
  if (!person) return false;
  if (person.role === "client") return false;
  const name = person.name ?? "";
  const email = person.email ?? "";
  const first = firstName(name);
  const full = normTr(name);
  const local = normTr(email).split("@")[0] ?? "";
  return ADS_PUBLISH_PEOPLE.some((raw) => {
    const n = normTr(raw);
    return first === n || full === n || local.includes(n);
  });
}
