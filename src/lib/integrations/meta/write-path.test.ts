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
  it("no method:POST outside write.ts graphPost", () => {
    const root = resolve(process.cwd(), "src/lib/integrations/meta");
    const offenders: string[] = [];
    for (const file of walkTs(root)) {
      const rel = file.replace(process.cwd() + "/", "");
      if (rel.endsWith("write.ts") || rel.endsWith("write-log.ts")) continue;
      const src = readFileSync(file, "utf8");
      if (/method:\s*["']POST["']/.test(src)) {
        offenders.push(rel);
      }
      // Ham fetch ile Graph yazımı
      if (
        /fetch\([^)]*graph\.facebook\.com[^)]*\)[\s\S]{0,80}method:\s*["']POST["']/.test(
          src,
        )
      ) {
        offenders.push(rel + " (fetch POST)");
      }
    }
    expect(offenders).toEqual([]);
  });

  it("write helpers call graphPost", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/lib/integrations/meta/write.ts"),
      "utf8",
    );
    expect(src).toMatch(/export async function graphPost/);
    expect(src).toMatch(/return graphPost\(adId/);
    expect(src).toMatch(/return graphPost\(adsetId/);
    expect(src).toMatch(/method:\s*"POST"/);
    // Okuma yolları graphFetch (GET) — yazma değil
    expect(src).toMatch(/fetchLiveAdSnapshot[\s\S]*graphFetch/);
  });

  it("ads-publish job-runner only uses write.ts updaters", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/lib/panel/ads-publish/job-runner.ts"),
      "utf8",
    );
    expect(src).toMatch(/from "@/lib\/integrations\/meta\/write"/);
    expect(src).not.toMatch(/method:\s*["']POST["']/);
    expect(src).not.toMatch(/graph\.facebook\.com/);
  });
});
