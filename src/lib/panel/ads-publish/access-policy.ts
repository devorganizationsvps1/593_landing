/**
 * Saf allowlist politikası — Next/auth bağımlılığı yok (test edilebilir).
 */
export const ADS_PUBLISH_PEOPLE = ["Hakan", "Numan", "Muhammet"] as const;

function normTr(value: string): string {
  return value.trim().toLocaleLowerCase("tr");
}

function firstName(value: string): string {
  return normTr(value).split(/\s+/)[0] ?? "";
}

export function canAccessAdsPublish(
  person: { name?: string | null; email?: string | null; role?: string | null } | null,
): boolean {
  if (!person) return false;
  if (person.role === "admin") return true;
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
