import { describe, expect, it, beforeEach, vi } from "vitest";

const auditFn = vi.fn(async () => undefined);

vi.mock("@/lib/panel/audit", () => ({
  audit: (...a: unknown[]) => auditFn(...a),
}));

import {
  clearMetaWriteLogsForTests,
  getRecentMetaWriteLogs,
  recordMetaWriteCall,
} from "@/lib/integrations/meta/write-log";

describe("meta write request log", () => {
  beforeEach(() => {
    clearMetaWriteLogsForTests();
    auditFn.mockClear();
  });

  it("records dry-run without token fields", async () => {
    await recordMetaWriteCall({
      dryRun: true,
      path: "12001",
      body: { status: "PAUSED", access_token: "SECRET" },
    });
    const logs = getRecentMetaWriteLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.dryRun).toBe(true);
    expect(logs[0]!.body).toEqual({ status: "PAUSED" });
    expect(auditFn).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        action: "meta.write.dry_run",
        entity: "meta_write",
      }),
    );
  });

  it("graphPost dry-run logs and skips Graph HTTP", async () => {
    vi.resetModules();
    clearMetaWriteLogsForTests();
    const graphFetch = vi.fn();
    vi.doMock("@/lib/integrations/meta/graph", () => ({
      MetaGraphError: class extends Error {},
      graphFetch,
    }));
    vi.doMock("@/lib/panel/audit", () => ({
      audit: (...a: unknown[]) => auditFn(...a),
    }));
    const { graphPost } = await import("@/lib/integrations/meta/write");
    const { getRecentMetaWriteLogs: getLogs } = await import(
      "@/lib/integrations/meta/write-log"
    );
    const r = await graphPost("ad_1", { status: "PAUSED" }, { allowLive: false });
    expect(r.dryRun).toBe(true);
    expect(graphFetch).not.toHaveBeenCalled();
    expect(getLogs().some((e) => e.dryRun && e.path === "ad_1")).toBe(true);
  });
});
