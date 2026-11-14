/**
 * Kalıcı koruma: her prisma.metaAd / include metaAds kullanımında
 * durum filtresi kararı zorunlu (ACTIVE veya bilinçli ALL).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(process.cwd(), "src");

/** Bilinçli olarak filtresiz (PAUSED dahil) — yorum + marker. */
const ALLOW_ALL = new Set([
  "lib/panel/ads-publish/meta-account-ads.ts",
  "lib/panel/ads-publish/ownership.ts",
  "lib/panel/ads-publish/approval-preview.ts",
  "lib/panel/sync.ts",
]);

/** effectiveStatus ACTIVE zorunlu. */
const REQUIRE_ACTIVE = new Set([
  "lib/panel/active-campaigns.ts",
  "lib/panel/brand-budget.ts",
  "lib/panel/data.ts",
  "lib/panel/setup-checks.ts",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".test.ts") || name.endsWith(".test.tsx")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

function usesMetaAdQuery(src: string): boolean {
  if (/prisma\.metaAd\./.test(src)) return true;
  if (/metaAds\s*:\s*(true|\{)/.test(src)) return true;
  if (/FROM\s+"MetaAd"/.test(src)) return true;
  return false;
}

function hasActiveFilter(src: string): boolean {
  return /effectiveStatus\s*:\s*["']ACTIVE["']/.test(src);
}

function hasAllowAllMarker(src: string): boolean {
  return (
    /META_AD_QUERY:\s*ALL/.test(src) ||
    /metaAd query:\s*all statuses/i.test(src) ||
    /Bilinçli:\s*filtresiz/i.test(src)
  );
}

describe("MetaAd query status-filter policy", () => {
  it("every metaAd consumer declares ACTIVE or ALL", () => {
    const offenders: string[] = [];
    const inventory: Array<{ file: string; policy: string }> = [];

    for (const file of walk(ROOT)) {
      const rel = relative(ROOT, file).replace(/\\/g, "/");
      const src = readFileSync(file, "utf8");
      if (!usesMetaAdQuery(src)) continue;

      if (REQUIRE_ACTIVE.has(rel)) {
        if (!hasActiveFilter(src)) {
          offenders.push(`${rel}: expected effectiveStatus ACTIVE`);
        }
        inventory.push({ file: rel, policy: "ACTIVE" });
        continue;
      }
      if (ALLOW_ALL.has(rel)) {
        if (!hasAllowAllMarker(src) && !hasActiveFilter(src)) {
          // sync/ownership/preview: require explicit marker
          if (!hasAllowAllMarker(src)) {
            offenders.push(`${rel}: add META_AD_QUERY: ALL marker`);
          }
        }
        inventory.push({ file: rel, policy: "ALL" });
        continue;
      }

      // Yeni dosya — sınıflandırılmamış
      if (hasActiveFilter(src)) {
        inventory.push({ file: rel, policy: "ACTIVE (unlisted)" });
      } else if (hasAllowAllMarker(src)) {
        inventory.push({ file: rel, policy: "ALL (unlisted)" });
      } else {
        offenders.push(
          `${rel}: classify in meta-ad-query-policy.test (ACTIVE or ALL+marker)`,
        );
      }
    }

    // Bilinen setlerin hepsi envanterde olsun
    for (const f of [...REQUIRE_ACTIVE, ...ALLOW_ALL]) {
      expect(
        inventory.some((i) => i.file === f),
        `missing consumer scan hit for ${f}`,
      ).toBe(true);
    }

    expect(offenders).toEqual([]);
  });

  it("no raw SQL MetaAd without policy file coverage", () => {
    const hits: string[] = [];
    for (const file of walk(ROOT)) {
      const rel = relative(ROOT, file).replace(/\\/g, "/");
      const src = readFileSync(file, "utf8");
      if (/FROM\s+"MetaAd"/.test(src)) hits.push(rel);
    }
    // Şu an ham SQL yok; olursa ALLOW/REQUIRE listesine eklenmeli
    expect(hits).toEqual([]);
  });
});
