/**
 * K2a sertleştirme — sahte yanıtlarla 1–7 ölçütleri.
 *
 * Eşleme (it → madde):
 *  1 geniş okuma/şekil · 2 şekil red · 3 fark koruması · 4 geri okuma
 *  5 uyarılar · 6 inceleme · 7 orphan (akış testleri)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertCreateBodyPreservesUnchangedFields,
  assertCreativeEditAllowed,
  assertReadBackMatchesExpected,
  buildAdCreativeCreateBody,
  creativeSideEffectWarnings,
  snapshotFromLiveCreative,
  UnsupportedCreativeShapeError,
  type CreativeEditMeta,
  type CreativeTextSnapshot,
} from "@/lib/panel/ads-publish/creative-edit";
import {
  classifyCreativeShape,
  creativeBodiesEqual,
  diffCreativeWriteBodies,
  isAllowedK2aDiffPath,
  verdictForShape,
  type CreativeShape,
} from "@/lib/panel/ads-publish/creative-shape";
import {
  formatReviewFeedback,
  reviewStatusLabel,
} from "@/lib/panel/ads-publish/orphan-creatives";
import {
  isWriteKindAllowed,
  WRITE_KINDS_K2,
} from "@/lib/panel/ads-publish/write-kinds";
import type { AdChangePayload } from "@/lib/panel/ads-publish/types";

const singleImage = {
  id: "cr_1",
  url_tags: "utm_source=x",
  instagram_user_id: "ig_99",
  degrees_of_freedom_spec: {
    creative_features_spec: {
      standard_enhancements: { enroll_status: "OPT_IN" },
    },
  },
  object_story_spec: {
    page_id: "page_1",
    instagram_user_id: "ig_99",
    link_data: {
      message: "Merhaba",
      name: "Başlık",
      description: "Açıklama",
      link: "https://example.com",
      image_hash: "hash1",
      image_crops: { "100x100": [[0, 0], [100, 100]] },
      call_to_action: {
        type: "LEARN_MORE",
        value: { link: "https://example.com" },
      },
    },
  },
};

const shapeFixtures: Record<
  Exclude<CreativeShape, "single_image_link" | "existing_post">,
  Record<string, unknown>
> = {
  video: {
    id: "cr_v",
    object_story_spec: {
      page_id: "p",
      video_data: { video_id: "vid", message: "hi", image_hash: "h" },
    },
  },
  carousel: {
    id: "cr_c",
    object_story_spec: {
      page_id: "p",
      link_data: {
        link: "https://x.com",
        child_attachments: [
          { link: "https://a", image_hash: "h1" },
          { link: "https://b", image_hash: "h2" },
        ],
      },
    },
  },
  asset_feed: {
    id: "cr_af",
    asset_feed_spec: { bodies: [{ text: "a" }, { text: "b" }] },
  },
  catalog: {
    id: "cr_cat",
    object_story_spec: {
      page_id: "p",
      template_data: { link: "https://cat" },
    },
  },
  unknown: {
    id: "cr_u",
    object_story_spec: {
      page_id: "p",
      photo_data: { message: "photo only", image_hash: "ph" },
    },
  },
};

function patchBody() {
  const current = snapshotFromLiveCreative(singleImage);
  const proposed = { ...current, primaryText: "Yeni metin" };
  const body = buildAdCreativeCreateBody({
    mode: "spec_patch",
    current,
    proposed,
    name: "test",
  });
  return { current, proposed, body };
}

describe("K2a shape classifier", () => {
  // → madde 1 + 2
  it("classifies single_image_link / video / carousel / asset_feed / catalog / existing_post", () => {
    expect(classifyCreativeShape(singleImage)).toBe("single_image_link");
    expect(classifyCreativeShape(shapeFixtures.video)).toBe("video");
    expect(classifyCreativeShape(shapeFixtures.carousel)).toBe("carousel");
    expect(classifyCreativeShape(shapeFixtures.asset_feed)).toBe("asset_feed");
    expect(classifyCreativeShape(shapeFixtures.catalog)).toBe("catalog");
    expect(
      classifyCreativeShape({
        object_story_id: "page_1_post_9",
        effective_object_story_id: "page_1_post_9",
      }),
    ).toBe("existing_post");
    expect(classifyCreativeShape(shapeFixtures.unknown)).toBe("unknown");
  });

  // → madde 2
  it("only single_image_link and existing_post are K2a-editable", () => {
    expect(verdictForShape("single_image_link").k2aEditable).toBe(true);
    expect(verdictForShape("existing_post").k2aEditable).toBe(true);
    expect(verdictForShape("existing_post").k2aMode).toBe("url_tags_only");
    for (const s of [
      "video",
      "carousel",
      "asset_feed",
      "catalog",
      "unknown",
    ] as const) {
      const v = verdictForShape(s);
      expect(v.k2aEditable).toBe(false);
      expect(v.code).toBe("unsupported_creative_shape");
    }
  });
});

describe("K2a unsupported shapes — ayrı ret", () => {
  // → madde 2 (her şekil ayrı)
  for (const shape of Object.keys(shapeFixtures) as Array<
    keyof typeof shapeFixtures
  >) {
    it(`rejects ${shape} with unsupported_creative_shape`, () => {
      const snap = snapshotFromLiveCreative(shapeFixtures[shape]);
      expect(snap.shape).toBe(shape);
      expect(() =>
        assertCreativeEditAllowed({
          mode: "spec_patch",
          current: snap,
          proposed: snap,
        }),
      ).toThrow(UnsupportedCreativeShapeError);
      try {
        assertCreativeEditAllowed({
          mode: "spec_patch",
          current: snap,
          proposed: snap,
        });
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(UnsupportedCreativeShapeError);
        expect((err as UnsupportedCreativeShapeError).code).toBe(
          "unsupported_creative_shape",
        );
        expect((err as UnsupportedCreativeShapeError).shape).toBe(shape);
      }
    });
  }
});

describe("K2a diff preservation", () => {
  // → madde 1 + 3
  it("passes when only changed fields differ (text/url_tags)", () => {
    const { current, body } = patchBody();
    body.url_tags = "utm_campaign=k2a";
    expect(() =>
      assertCreateBodyPreservesUnchangedFields({
        mode: "spec_patch",
        current,
        createBody: body,
      }),
    ).not.toThrow();

    const spec = body.object_story_spec as {
      link_data: { message: string; image_hash: string; image_crops: unknown };
    };
    expect(spec.link_data.message).toBe("Yeni metin");
    expect(spec.link_data.image_hash).toBe("hash1");
    expect(spec.link_data.image_crops).toEqual(
      singleImage.object_story_spec.link_data.image_crops,
    );
    expect(body.instagram_user_id).toBe("ig_99");
    expect(body.degrees_of_freedom_spec).toEqual(
      singleImage.degrees_of_freedom_spec,
    );

    const paths = diffCreativeWriteBodies(
      {
        object_story_spec: current.objectStorySpec,
        url_tags: current.urlTags,
        ...current.writeExtras,
      },
      body,
    );
    expect(paths.every(isAllowedK2aDiffPath)).toBe(true);
  });

  // → madde 3
  it("rejects when instagram_user_id drops", () => {
    const { current, body } = patchBody();
    delete body.instagram_user_id;
    expect(() =>
      assertCreateBodyPreservesUnchangedFields({
        mode: "spec_patch",
        current,
        createBody: body,
      }),
    ).toThrow(/fark koruması|beklenmeyen/i);
  });

  // → madde 3
  it("rejects when degrees_of_freedom_spec drops", () => {
    const { current, body } = patchBody();
    delete body.degrees_of_freedom_spec;
    expect(() =>
      assertCreateBodyPreservesUnchangedFields({
        mode: "spec_patch",
        current,
        createBody: body,
      }),
    ).toThrow(/fark koruması|beklenmeyen/i);
  });

  // → madde 3
  it("rejects when image_crops drops", () => {
    const { current, body } = patchBody();
    const spec = body.object_story_spec as {
      link_data: Record<string, unknown>;
    };
    delete spec.link_data.image_crops;
    expect(() =>
      assertCreateBodyPreservesUnchangedFields({
        mode: "spec_patch",
        current,
        createBody: body,
      }),
    ).toThrow(/fark koruması|beklenmeyen/i);
  });

  // → madde 4
  it("read-back fails if live creative lost crops/IG/DOF", () => {
    const { body } = patchBody();
    const liveMissing = {
      id: "cr_new",
      object_story_spec: {
        page_id: "page_1",
        link_data: {
          message: "Yeni metin",
          name: "Başlık",
          description: "Açıklama",
          link: "https://example.com",
          image_hash: "hash1",
          call_to_action: {
            type: "LEARN_MORE",
            value: { link: "https://example.com" },
          },
        },
      },
      url_tags: "utm_source=x",
    };
    expect(() =>
      assertReadBackMatchesExpected({
        expectedCreateBody: body,
        liveCreative: liveMissing,
      }),
    ).toThrow(/geri okuma/i);
  });

  // → madde 4
  it("read-back passes when live matches expected create body", () => {
    const { body } = patchBody();
    expect(() =>
      assertReadBackMatchesExpected({
        expectedCreateBody: body,
        liveCreative: { id: "cr_new", name: "ignored", ...body },
      }),
    ).not.toThrow();
  });
});

describe("K2a warnings", () => {
  // → madde 5
  it("new post warning is explicit; url_tags_only says engagement preserved", () => {
    const patch = creativeSideEffectWarnings("spec_patch").join(" ");
    expect(patch).toMatch(/taşınmaz/);
    expect(patch).toMatch(/incelemeye/);

    const utm = creativeSideEffectWarnings("url_tags_only").join(" ");
    expect(utm).toMatch(/korunur/);
    expect(utm).not.toMatch(/taşınmaz/);
  });
});

describe("K2a allowlist still K2a-only", () => {
  // → madde 2 (kapsam; K2b/K2c yok)
  it("no media/schedule in K2 kinds", () => {
    expect(WRITE_KINDS_K2).toContain("creative.create");
    expect(WRITE_KINDS_K2).not.toContain("creative.media");
    expect(WRITE_KINDS_K2).not.toContain("adset.schedule");
    expect(isWriteKindAllowed("creative.bind", { k2: true })).toBe(true);
  });
});

describe("creativeBodiesEqual normalize", () => {
  // → madde 3
  it("ignores name and empty fields", () => {
    expect(
      creativeBodiesEqual(
        { url_tags: "a=1", name: "old" },
        { url_tags: "a=1", name: "new" },
      ),
    ).toBe(true);
  });
});

describe("UnsupportedCreativeShapeError", () => {
  // → madde 2
  it("has code", () => {
    const e = new UnsupportedCreativeShapeError("nope", "carousel");
    expect(e.code).toBe("unsupported_creative_shape");
    expect(e.shape).toBe("carousel");
  });
});

describe("K2a review labels", () => {
  // → madde 6
  it("maps effective_status and serializes feedback", () => {
    expect(reviewStatusLabel("PENDING_REVIEW")).toBe("İncelemede");
    expect(reviewStatusLabel("DISAPPROVED")).toBe("Reddedildi");
    expect(reviewStatusLabel("ACTIVE")).toMatch(/Onaylandı/);
    expect(formatReviewFeedback({ global: { reason: "POLICY" } })).toMatch(
      /POLICY/,
    );
  });
});

describe("K2a url_tags_only create body", () => {
  // → madde 2 + object_story_id koruma
  it("keeps same object_story_id when only UTM changes", () => {
    const current = snapshotFromLiveCreative({
      id: "cr_post",
      object_story_id: "page_1_post_9",
      url_tags: "utm_source=old",
      instagram_user_id: "ig_1",
    });
    expect(current.shape).toBe("existing_post");
    const body = buildAdCreativeCreateBody({
      mode: "url_tags_only",
      current,
      proposed: { ...current, urlTags: "utm_source=new" },
      name: "utm",
    });
    expect(body.object_story_id).toBe("page_1_post_9");
    expect(body.url_tags).toBe("utm_source=new");
    expect(body.object_story_spec).toBeUndefined();
    expect(body.instagram_user_id).toBe("ig_1");
    expect(() =>
      assertCreateBodyPreservesUnchangedFields({
        mode: "url_tags_only",
        current,
        createBody: body,
      }),
    ).not.toThrow();
  });
});

// ─── Akış: create read-back → bind / orphan / review notice (madde 4, 6, 7) ───

const createAdCreative = vi.fn();
const bindAdCreative = vi.fn();
const fetchLiveCreativeById = vi.fn();
const fetchLiveAdSnapshot = vi.fn();
const fetchLiveAdCreative = vi.fn();
const recordOrphanCreative = vi.fn();
const createPanelNotice = vi.fn();

vi.mock("@/lib/integrations/meta/write", () => ({
  createAdCreative: (...a: unknown[]) => createAdCreative(...a),
  bindAdCreative: (...a: unknown[]) => bindAdCreative(...a),
  fetchLiveCreativeById: (...a: unknown[]) => fetchLiveCreativeById(...a),
  fetchLiveAdSnapshot: (...a: unknown[]) => fetchLiveAdSnapshot(...a),
  fetchLiveAdCreative: (...a: unknown[]) => fetchLiveAdCreative(...a),
  updateAdStatus: vi.fn(),
  updateAdsetDailyBudget: vi.fn(),
  updateAdsetStatus: vi.fn(),
}));

vi.mock("@/lib/panel/ads-publish/orphan-creatives", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/panel/ads-publish/orphan-creatives")
  >("@/lib/panel/ads-publish/orphan-creatives");
  return {
    ...actual,
    recordOrphanCreative: (...a: unknown[]) => recordOrphanCreative(...a),
  };
});

vi.mock("@/lib/panel/panel-notices", () => ({
  createPanelNotice: (...a: unknown[]) => createPanelNotice(...a),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    adChangeJobStep: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    adChangeJob: {
      findUnique: vi.fn(),
    },
    adChangePackage: {
      update: vi.fn(),
    },
    adChangePackageVersion: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/panel/audit", () => ({
  audit: vi.fn(async () => undefined),
}));

function buildSpecPatchPayload(
  current: CreativeTextSnapshot,
  proposed: CreativeTextSnapshot,
  extras?: Partial<CreativeEditMeta>,
): AdChangePayload {
  const meta: CreativeEditMeta = {
    mode: "spec_patch",
    shape: current.shape,
    currentCreativeId: "cr_1",
    current,
    proposed,
    currentFingerprint: "fp",
    ...extras,
  };
  return {
    target: {
      adId: "ad_1",
      adsetId: "as_1",
      campaignId: "c_1",
      adAccountId: "act_1",
    },
    changes: [
      {
        field: "creative.primary_text",
        label: "Ana metin",
        current: current.primaryText,
        proposed: proposed.primaryText,
      },
    ],
    plan: [
      { key: "creative.create", label: "create" },
      { key: "creative.bind", label: "bind", dependsOn: "creative.create" },
    ],
    creative: meta as unknown as AdChangePayload["creative"],
  };
}

describe("K2a create/bind flow (fake Meta + prisma)", () => {
  const prevToken = process.env.META_SYSTEM_USER_TOKEN;

  beforeEach(async () => {
    vi.resetModules();
    createAdCreative.mockReset();
    bindAdCreative.mockReset();
    fetchLiveCreativeById.mockReset();
    fetchLiveAdSnapshot.mockReset();
    fetchLiveAdCreative.mockReset();
    recordOrphanCreative.mockReset().mockResolvedValue(undefined);
    createPanelNotice.mockReset().mockResolvedValue(undefined);
    process.env.META_SYSTEM_USER_TOKEN = "test-token";

    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.adChangeJobStep.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.adChangeJobStep.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.adChangeJobStep.update).mockResolvedValue({} as never);
    vi.mocked(prisma.adChangeJob.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.adChangePackage.update).mockResolvedValue({} as never);
    vi.mocked(prisma.adChangePackageVersion.findUnique).mockResolvedValue(
      null,
    );
    vi.mocked(prisma.adChangePackageVersion.update).mockResolvedValue(
      {} as never,
    );
  });

  afterEach(() => {
    process.env.META_SYSTEM_USER_TOKEN = prevToken;
  });

  // → madde 4 + 7
  it("read-back mismatch → no bind, create rejected, orphan recorded", async () => {
    const { applyAllowedStep } = await import(
      "@/lib/panel/ads-publish/job-runner"
    );
    const current = snapshotFromLiveCreative(singleImage);
    const proposed = { ...current, primaryText: "Yeni metin" };
    const payload = buildSpecPatchPayload(current, proposed);

    createAdCreative.mockResolvedValue({
      dryRun: false,
      json: { id: "cr_orphan" },
    });
    fetchLiveCreativeById.mockResolvedValue({
      id: "cr_orphan",
      object_story_spec: {
        page_id: "page_1",
        link_data: {
          message: "Yeni metin",
          name: "Başlık",
          description: "Açıklama",
          link: "https://example.com",
          image_hash: "hash1",
          call_to_action: {
            type: "LEARN_MORE",
            value: { link: "https://example.com" },
          },
        },
      },
      url_tags: "utm_source=x",
    });

    const createResult = await applyAllowedStep("creative.create", payload, {
      allowLive: true,
      tenantId: "ten_1",
      jobId: "job_1",
      stepId: "step_create",
    });

    expect(createResult.rejected).toBe(true);
    expect(createResult.code).toBe("readback_mismatch");
    expect(createResult.orphanRecorded).toBe(true);
    expect(recordOrphanCreative).toHaveBeenCalledWith(
      expect.objectContaining({
        creativeId: "cr_orphan",
        reason: "readback_mismatch",
        tenantId: "ten_1",
      }),
    );
    expect(bindAdCreative).not.toHaveBeenCalled();

    const src = readFileSync(
      resolve(process.cwd(), "src/lib/panel/ads-publish/job-runner.ts"),
      "utf8",
    );
    expect(src).toMatch(/if \(result\.rejected\)/);
    expect(src).toMatch(/status:\s*"failed"/);
    expect(src).toMatch(/readback_mismatch/);
  });

  // → madde 4
  it("read-back ok → create succeeds; bind applies with matching creative", async () => {
    const { applyAllowedStep } = await import(
      "@/lib/panel/ads-publish/job-runner"
    );
    const current = snapshotFromLiveCreative(singleImage);
    const proposed = { ...current, primaryText: "Yeni metin" };
    const payload = buildSpecPatchPayload(current, proposed);

    createAdCreative.mockImplementation(
      async (_account: string, body: Record<string, unknown>) => {
        fetchLiveCreativeById.mockResolvedValue({
          id: "cr_new",
          ...body,
        });
        return { dryRun: false, json: { id: "cr_new" } };
      },
    );

    const createResult = await applyAllowedStep("creative.create", payload, {
      allowLive: true,
      tenantId: "ten_1",
      jobId: "job_1",
      stepId: "step_create",
    });
    expect(createResult.rejected).toBeFalsy();
    expect(createResult.readBackOk).toBe(true);
    expect(createResult.newCreativeId).toBe("cr_new");
    expect(recordOrphanCreative).not.toHaveBeenCalled();

    const bindPayload = buildSpecPatchPayload(current, proposed, {
      newCreativeId: "cr_new",
    });
    fetchLiveAdSnapshot
      .mockResolvedValueOnce({
        id: "ad_1",
        status: "PAUSED",
        effective_status: "PAUSED",
        creative: { id: "cr_1" },
      })
      .mockResolvedValueOnce({
        id: "ad_1",
        status: "PAUSED",
        effective_status: "PENDING_REVIEW",
        creative: { id: "cr_new" },
        ad_review_feedback: null,
      });
    bindAdCreative.mockResolvedValue({
      dryRun: false,
      json: { success: true },
    });

    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.adChangeJob.findUnique).mockResolvedValue({
      packageId: "pkg_1",
      package: {
        createdById: "user_1",
        title: "Test paket",
        tenant: { slug: "demo" },
      },
    } as never);

    const bindResult = await applyAllowedStep("creative.bind", bindPayload, {
      allowLive: true,
      tenantId: "ten_1",
      jobId: "job_1",
      stepId: "step_bind",
    });
    expect(bindAdCreative).toHaveBeenCalledWith(
      "ad_1",
      "cr_new",
      expect.any(Object),
    );
    expect(bindResult.rejected).toBeFalsy();
    expect(bindResult.verified).toBe(true);
    expect(bindResult.effectiveStatus).toBe("PENDING_REVIEW");
  });

  // → madde 6
  it("bind after DISAPPROVED → package feedback + panel notice", async () => {
    const { applyAllowedStep } = await import(
      "@/lib/panel/ads-publish/job-runner"
    );
    const { prisma } = await import("@/lib/db");
    const current = snapshotFromLiveCreative(singleImage);
    const proposed = { ...current, primaryText: "Yeni metin" };
    const bindPayload = buildSpecPatchPayload(current, proposed, {
      newCreativeId: "cr_new",
    });

    fetchLiveAdSnapshot
      .mockResolvedValueOnce({
        id: "ad_1",
        creative: { id: "cr_1" },
      })
      .mockResolvedValueOnce({
        id: "ad_1",
        effective_status: "DISAPPROVED",
        creative: { id: "cr_new" },
        ad_review_feedback: { global: { summary: "Text policy" } },
      });
    bindAdCreative.mockResolvedValue({ dryRun: false, json: {} });
    vi.mocked(prisma.adChangeJob.findUnique).mockResolvedValue({
      packageId: "pkg_1",
      package: {
        createdById: "user_1",
        title: "Red paket",
        tenant: { slug: "demo" },
      },
    } as never);

    const bindResult = await applyAllowedStep("creative.bind", bindPayload, {
      allowLive: true,
      tenantId: "ten_1",
      jobId: "job_1",
      stepId: "step_bind",
    });

    expect(bindResult.effectiveStatus).toBe("DISAPPROVED");
    expect(String(bindResult.reviewFeedback)).toMatch(/Text policy/);
    expect(prisma.adChangePackage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pkg_1" },
        data: expect.objectContaining({
          metaReviewStatus: "DISAPPROVED",
          metaReviewFeedback: expect.stringMatching(/Text policy/),
        }),
      }),
    );
    expect(createPanelNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_1",
        kind: "ad_change.review_disapproved",
        title: expect.stringMatching(/Red paket/),
      }),
    );
  });

  // → madde 4 + 7
  it("bind skipped when prior create step recorded readback_mismatch", async () => {
    const { applyAllowedStep } = await import(
      "@/lib/panel/ads-publish/job-runner"
    );
    const { prisma } = await import("@/lib/db");
    const current = snapshotFromLiveCreative(singleImage);
    const proposed = { ...current, primaryText: "Yeni metin" };
    const payload = buildSpecPatchPayload(current, proposed);
    vi.mocked(prisma.adChangeJobStep.findFirst).mockResolvedValue({
      result: {
        newCreativeId: "cr_orphan",
        rejected: true,
        code: "readback_mismatch",
      },
      status: "failed",
    } as never);

    const bindResult = await applyAllowedStep("creative.bind", payload, {
      allowLive: true,
      tenantId: "ten_1",
      jobId: "job_1",
      stepId: "step_bind",
    });
    expect(bindResult.rejected).toBe(true);
    expect(bindResult.code).toBe("readback_mismatch");
    expect(bindAdCreative).not.toHaveBeenCalled();
  });
});
