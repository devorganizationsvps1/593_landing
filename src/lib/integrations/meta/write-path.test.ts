/**
 * Meta’ya GET dışındaki tüm istekler yalnızca graphPost üzerinden.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".test.ts")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkTs(p, out);
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("Meta write path = graphPost only", () => {
  it("no method:POST outside write.ts graphPost (meta + ads-publish)", () => {
    const roots = [
      resolve(process.cwd(), "src/lib/integrations/meta"),
      resolve(process.cwd(), "src/lib/panel/ads-publish"),
    ];
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of walkTs(root)) {
        const rel = file.replace(process.cwd() + "/", "");
        if (rel.endsWith("write.ts") || rel.endsWith("write-log.ts")) continue;
        const src = readFileSync(file, "utf8");
        // Meta Graph yazımı: POST + graph.facebook.com aynı dosyada
        if (
          /graph\.facebook\.com/.test(src) &&
          /method:\s*["']POST["']/.test(src)
        ) {
          offenders.push(rel + " (graph+POST)");
        }
        if (
          /fetch\([^)]*graph\.facebook\.com[^)]*\)[\s\S]{0,120}method:\s*["'](POST|PUT|PATCH|DELETE)["']/.test(
            src,
          )
        ) {
          offenders.push(rel + " (fetch write)");
        }
        // integrations/meta altında ham method:POST yasak (yalnızca write.ts)
        if (
          root.endsWith("/meta") &&
          /method:\s*["']POST["']/.test(src)
        ) {
          offenders.push(rel);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("write helpers call graphPost; only graphPost sets POST", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/lib/integrations/meta/write.ts"),
      "utf8",
    );
    expect(src).toMatch(/export async function graphPost/);
    expect(src).toMatch(/return graphPost\(adId/);
    expect(src).toMatch(/return graphPost\(adsetId/);
    const postMatches = src.match(/method:\s*"POST"/g) ?? [];
    expect(postMatches).toHaveLength(1);
    // Okuma yolları graphFetch (GET) — yazma değil
    expect(src).toMatch(/fetchLiveAdSnapshot[\s\S]*graphFetch/);
  });

  it("ads-publish job-runner only uses write.ts updaters", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/lib/panel/ads-publish/job-runner.ts"),
      "utf8",
    );
    expect(src.includes('from "@/lib/integrations/meta/write"')).toBe(true);
    expect(src).not.toMatch(/method:\s*["']POST["']/);
    expect(src).not.toMatch(/graph\.facebook\.com/);
  });
});

