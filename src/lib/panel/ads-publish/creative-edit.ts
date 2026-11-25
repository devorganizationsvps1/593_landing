/**
 * K2a — metin / URL / UTM (yalnızca tek görsel link + mevcut gönderi UTM).
 * Geniş okuma → deep-copy → whitelist patch → fark koruması → create → read-back.
 */
import { createHash } from "node:crypto";
import type {
  AdChangeField,
  AdChangePayload,
  AdChangePlanStep,
} from "@/lib/panel/ads-publish/types";
import { stableStringify } from "@/lib/panel/ads-publish/write-kinds";
import {
  assertOnlyAllowedDiffs,
  classifyAndVerdict,
  classifyCreativeShape,
  CREATIVE_WRITE_TOP_KEYS,
  creativeBodiesEqual,
  diffCreativeWriteBodies,
  normalizeCreativeWriteBody,
  stripReadOnlyCreativeFields,
  UnsupportedCreativeShapeError,
  type CreativeShape,
  type CreativeShapeVerdict,
} from "@/lib/panel/ads-publish/creative-shape";

export const K2A_CREATIVE_FIELDS = [
  "creative.primary_text",
  "creative.headline",
  "creative.description",
  "creative.cta",
  "creative.link",
  "creative.url_tags",
] as const;

export type K2aCreativeField = (typeof K2A_CREATIVE_FIELDS)[number];

export type CreativeEditMode = "spec_patch" | "url_tags_only" | "revert_bind";

export type CreativeTextSnapshot = {
  objectStoryId: string | null;
  effectiveObjectStoryId: string | null;
  urlTags: string;
  primaryText: string;
  headline: string;
  description: string;
  cta: string;
  link: string;
  pageId: string | null;
  imageHash: string | null;
  videoId: string | null;
  instagramUserId: string | null;
  objectStorySpec: Record<string, unknown> | null;
  /** Create body için üst düzey alanlar (DOF, IG, crops…). */
  writeExtras: Record<string, unknown>;
  /** Ham Graph kreatif (read-back / envanter). */
  raw: Record<string, unknown>;
  shape: CreativeShape;
  hasObjectStorySpec: boolean;
  isExistingPost: boolean;
  isCatalog: boolean;
};

export type CreativeEditMeta = {
  mode: CreativeEditMode;
  shape: CreativeShape;
  currentCreativeId: string;
  newCreativeId?: string | null;
  restoreCreativeId?: string | null;
  current: CreativeTextSnapshot;
  proposed: CreativeTextSnapshot;
  currentFingerprint: string;
  /** Create’e gönderilecek normalize body (diff koruması). */
  expectedCreateBody?: Record<string, unknown>;
};

export type LiveCreativeRaw = Record<string, unknown> & {
  id?: string;
  name?: string;
  url_tags?: string | null;
  object_story_id?: string | null;
  effective_object_story_id?: string | null;
  image_hash?: string | null;
  video_id?: string | null;
  instagram_user_id?: string | null;
  object_story_spec?: Record<string, unknown> | null;
  asset_feed_spec?: unknown;
  degrees_of_freedom_spec?: unknown;
  product_set_id?: string | null;
  object_type?: string | null;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function ctaType(raw: unknown): string {
  const rec = asRecord(raw);
  if (!rec) return "";
  return str(rec.type).toUpperCase();
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Üst düzey create alanlarını ham kreatiften çıkar. */
export function extractWriteExtras(
  creative: LiveCreativeRaw,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of CREATIVE_WRITE_TOP_KEYS) {
    if (key === "object_story_spec" || key === "object_story_id" || key === "url_tags") {
      continue;
    }
    const v = creative[key];
    if (v !== undefined && v !== null && v !== "") out[key] = deepClone(v);
  }
  return out;
}

export function snapshotFromLiveCreative(
  creative: LiveCreativeRaw,
): CreativeTextSnapshot {
  const spec = asRecord(creative.object_story_spec);
  const linkData = asRecord(spec?.link_data);
  const videoData = asRecord(spec?.video_data);
  const photoData = asRecord(spec?.photo_data);
  const hasSpec = Boolean(linkData || videoData || photoData);
  const objectStoryId = str(creative.object_story_id).trim() || null;
  const effectiveObjectStoryId =
    str(creative.effective_object_story_id).trim() || null;
  const shape = classifyCreativeShape(creative);
  const isCatalog = shape === "catalog";
  const isExistingPost = shape === "existing_post";

  let primaryText = "";
  let headline = "";
  let description = "";
  let cta = "";
  let link = "";
  let imageHash = str(creative.image_hash).trim() || null;
  let videoId = str(creative.video_id).trim() || null;
  const pageId = str(spec?.page_id).trim() || null;
  const instagramUserId =
    str(creative.instagram_user_id).trim() ||
    str(spec?.instagram_user_id).trim() ||
    null;

  if (linkData) {
    primaryText = str(linkData.message);
    headline = str(linkData.name);
    description = str(linkData.description);
    link = str(linkData.link);
    cta = ctaType(linkData.call_to_action);
    const ctaVal = asRecord(asRecord(linkData.call_to_action)?.value);
    if (!link && ctaVal?.link) link = str(ctaVal.link);
    if (str(linkData.image_hash)) imageHash = str(linkData.image_hash);
  } else if (videoData) {
    primaryText = str(videoData.message);
    headline = str(videoData.title);
    description = str(videoData.link_description);
    cta = ctaType(videoData.call_to_action);
    const ctaVal = asRecord(asRecord(videoData.call_to_action)?.value);
    link = str(ctaVal?.link);
    if (str(videoData.image_hash)) imageHash = str(videoData.image_hash);
    videoId = str(videoData.video_id).trim() || videoId;
  } else if (photoData) {
    primaryText = str(photoData.message);
    if (str(photoData.image_hash)) imageHash = str(photoData.image_hash);
  }

  return {
    objectStoryId,
    effectiveObjectStoryId,
    urlTags: str(creative.url_tags),
    primaryText,
    headline,
    description,
    cta,
    link,
    pageId,
    imageHash,
    videoId,
    instagramUserId,
    objectStorySpec: spec ? deepClone(spec) : null,
    writeExtras: extractWriteExtras(creative),
    raw: deepClone(creative as Record<string, unknown>),
    shape,
    hasObjectStorySpec: hasSpec,
    isExistingPost,
    isCatalog,
  };
}

export function creativeFingerprint(snapshot: CreativeTextSnapshot): string {
  const body = {
    shape: snapshot.shape,
    objectStoryId: snapshot.objectStoryId,
    urlTags: snapshot.urlTags,
    primaryText: snapshot.primaryText,
    headline: snapshot.headline,
    description: snapshot.description,
    cta: snapshot.cta,
    link: snapshot.link,
    pageId: snapshot.pageId,
    imageHash: snapshot.imageHash,
    instagramUserId: snapshot.instagramUserId,
    writeExtras: normalizeCreativeWriteBody(snapshot.writeExtras),
    objectStorySpec: normalizeCreativeWriteBody(
      snapshot.objectStorySpec ?? {},
    ),
  };
  return createHash("sha256").update(stableStringify(body)).digest("hex");
}

export function detectDefaultMode(
  snapshot: CreativeTextSnapshot,
): CreativeEditMode {
  const v = verdictFromSnapshot(snapshot);
  if (!v.k2aEditable || !v.k2aMode) {
    throw new UnsupportedCreativeShapeError(
      v.lockReason || "unsupported_creative_shape",
      v.shape,
    );
  }
  return v.k2aMode;
}

export function verdictFromSnapshot(
  snapshot: CreativeTextSnapshot,
): CreativeShapeVerdict {
  return classifyAndVerdict({
    object_story_id: snapshot.objectStoryId,
    effective_object_story_id: snapshot.effectiveObjectStoryId,
    object_story_spec: snapshot.objectStorySpec,
    asset_feed_spec: snapshot.raw.asset_feed_spec,
    degrees_of_freedom_spec: snapshot.raw.degrees_of_freedom_spec,
    product_set_id: str(snapshot.raw.product_set_id) || null,
    template_url: str(snapshot.raw.template_url) || null,
    video_id: snapshot.videoId,
  });
}

export function assertCreativeEditAllowed(opts: {
  mode: CreativeEditMode;
  current: CreativeTextSnapshot;
  proposed: CreativeTextSnapshot;
}): void {
  const { mode, current, proposed } = opts;
  if (mode === "revert_bind") return;

  const verdict = verdictFromSnapshot(current);
  if (!verdict.k2aEditable) {
    throw new UnsupportedCreativeShapeError(
      verdict.lockReason || "unsupported_creative_shape",
      verdict.shape,
    );
  }
  if (verdict.k2aMode !== mode) {
    throw new Error(
      `Mod uyuşmazlığı: şekil ${verdict.shape} için beklenen ${verdict.k2aMode}, gelen ${mode}.`,
    );
  }

  if (mode === "url_tags_only") {
    const textChanged =
      proposed.primaryText !== current.primaryText ||
      proposed.headline !== current.headline ||
      proposed.description !== current.description ||
      proposed.cta !== current.cta ||
      proposed.link !== current.link;
    if (textChanged) {
      throw new Error(
        "Mevcut gönderide K2a yalnızca UTM (url_tags) değiştirir; metin/URL kilitli.",
      );
    }
    if (proposed.urlTags === current.urlTags) {
      throw new Error("UTM / url_tags değişmedi.");
    }
    return;
  }

  if (mode === "spec_patch") {
    if (current.shape !== "single_image_link" || !current.objectStorySpec) {
      throw new UnsupportedCreativeShapeError(
        "spec_patch yalnızca tek görsel bağlantı için.",
        current.shape,
      );
    }
  }
}

export function buildCreativePlan(mode: CreativeEditMode): AdChangePlanStep[] {
  if (mode === "revert_bind") {
    return [{ key: "creative.bind", label: "Önceki kreatife bağla" }];
  }
  return [
    { key: "creative.create", label: "Yeni kreatif oluştur" },
    {
      key: "creative.bind",
      label: "Kreatifi reklama bağla",
      dependsOn: "creative.create",
    },
  ];
}

export function buildCreativeFieldChanges(opts: {
  current: CreativeTextSnapshot;
  proposed: CreativeTextSnapshot;
  mode: CreativeEditMode;
}): AdChangeField[] {
  const { current, proposed, mode } = opts;
  if (mode === "revert_bind") {
    return [
      {
        field: "creative.bind",
        label: "Kreatif kimliği",
        current: null,
        proposed: null,
      },
    ];
  }
  const pairs: Array<{
    field: K2aCreativeField;
    label: string;
    cur: string;
    prop: string;
  }> = [
    {
      field: "creative.primary_text",
      label: "Ana metin",
      cur: current.primaryText,
      prop: proposed.primaryText,
    },
    {
      field: "creative.headline",
      label: "Başlık",
      cur: current.headline,
      prop: proposed.headline,
    },
    {
      field: "creative.description",
      label: "Açıklama",
      cur: current.description,
      prop: proposed.description,
    },
    {
      field: "creative.cta",
      label: "CTA",
      cur: current.cta,
      prop: proposed.cta,
    },
    {
      field: "creative.link",
      label: "Hedef URL",
      cur: current.link,
      prop: proposed.link,
    },
    {
      field: "creative.url_tags",
      label: "UTM",
      cur: current.urlTags,
      prop: proposed.urlTags,
    },
  ];
  const out: AdChangeField[] = [];
  for (const p of pairs) {
    if (mode === "url_tags_only" && p.field !== "creative.url_tags") continue;
    if (p.cur === p.prop) continue;
    out.push({
      field: p.field,
      label: p.label,
      current: p.cur || null,
      proposed: p.prop,
    });
  }
  return out;
}

/**
 * Mevcut kreatiften create body: tüm write alanları korunur, yalnızca
 * whitelist patch uygulanır; sonra fark koruması çağıran tarafından doğrulanır.
 */
export function buildAdCreativeCreateBody(opts: {
  mode: CreativeEditMode;
  current: CreativeTextSnapshot;
  proposed: CreativeTextSnapshot;
  name: string;
}): Record<string, unknown> {
  const { mode, current, proposed, name } = opts;

  if (mode === "url_tags_only") {
    const storyId =
      current.objectStoryId || current.effectiveObjectStoryId || "";
    if (!storyId) throw new Error("object_story_id yok");
    const body: Record<string, unknown> = {
      name,
      object_story_id: storyId,
      url_tags: proposed.urlTags,
    };
    // IG kimliği mevcut gönderi reklamlarında üst düzeyde olabilir
    if (current.instagramUserId) {
      body.instagram_user_id = current.instagramUserId;
    }
    for (const [k, v] of Object.entries(current.writeExtras)) {
      if (k === "instagram_user_id" && body.instagram_user_id) continue;
      // asset_feed / product_set existing_post’ta beklenmez; yine de taşıma
      if (v !== undefined) body[k] = deepClone(v);
    }
    return body;
  }

  // spec_patch — tek görsel link
  if (!current.objectStorySpec) {
    throw new Error("object_story_spec kopyalanamadı");
  }
  const nextSpec = deepClone(current.objectStorySpec);
  const linkData = asRecord(nextSpec.link_data);
  if (!linkData) throw new Error("spec_patch: link_data yok");

  linkData.message = proposed.primaryText;
  linkData.name = proposed.headline;
  linkData.description = proposed.description;
  if (proposed.link) {
    linkData.link = proposed.link;
    const cta = asRecord(linkData.call_to_action) || {};
    const value = asRecord(cta.value) || {};
    if (proposed.cta) cta.type = proposed.cta.toUpperCase();
    value.link = proposed.link;
    cta.value = value;
    linkData.call_to_action = cta;
  } else if (proposed.cta) {
    const cta = asRecord(linkData.call_to_action) || {};
    cta.type = proposed.cta.toUpperCase();
    linkData.call_to_action = cta;
  }
  nextSpec.link_data = linkData;

  const body: Record<string, unknown> = {
    name,
    object_story_spec: nextSpec,
    url_tags: proposed.urlTags || undefined,
  };
  for (const [k, v] of Object.entries(current.writeExtras)) {
    body[k] = deepClone(v);
  }
  return body;
}

/**
 * Eski write-body (mevcut kreatif) ile yeni create body arasında
 * yalnızca K2a izinli path’ler değişmiş olmalı.
 */
export function assertCreateBodyPreservesUnchangedFields(opts: {
  mode: CreativeEditMode;
  current: CreativeTextSnapshot;
  createBody: Record<string, unknown>;
}): void {
  const { mode, current, createBody } = opts;
  if (mode === "revert_bind") return;

  if (mode === "url_tags_only") {
    const baseline: Record<string, unknown> = {
      object_story_id:
        current.objectStoryId || current.effectiveObjectStoryId,
      url_tags: current.urlTags,
      ...current.writeExtras,
    };
    if (current.instagramUserId) {
      baseline.instagram_user_id = current.instagramUserId;
    }
    const paths = diffCreativeWriteBodies(baseline, {
      ...createBody,
      // name create’te değişir — stripReadOnly zaten name’i düşürür
    });
    assertOnlyAllowedDiffs(paths);
    return;
  }

  const baseline: Record<string, unknown> = {
    object_story_spec: current.objectStorySpec,
    url_tags: current.urlTags,
    ...current.writeExtras,
  };
  const paths = diffCreativeWriteBodies(baseline, createBody);
  assertOnlyAllowedDiffs(paths);
}

/** Create sonrası Graph kreatifi → write body ile karşılaştır. */
export function assertReadBackMatchesExpected(opts: {
  expectedCreateBody: Record<string, unknown>;
  liveCreative: LiveCreativeRaw;
}): void {
  const fromLive = writeBodyFromLiveCreative(opts.liveCreative);
  const expected = { ...opts.expectedCreateBody };
  if (creativeBodiesEqual(expected, fromLive)) return;
  const paths = diffCreativeWriteBodies(expected, fromLive);
  // IG/DOF/crop düştüyse paths’te görünür → ret (name stripReadOnly ile yok sayılır)
  if (paths.length > 0) {
    throw new Error(
      `Create geri okuma uyuşmazlığı: ${paths.slice(0, 10).join(", ")}`,
    );
  }
}

export function writeBodyFromLiveCreative(
  creative: LiveCreativeRaw,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (creative.object_story_spec) {
    body.object_story_spec = deepClone(creative.object_story_spec);
  }
  if (creative.object_story_id) {
    body.object_story_id = creative.object_story_id;
  }
  if (creative.url_tags != null && creative.url_tags !== "") {
    body.url_tags = creative.url_tags;
  }
  Object.assign(body, extractWriteExtras(creative));
  return stripReadOnlyCreativeFields(body);
}

export function creativeSideEffectWarnings(mode: CreativeEditMode): string[] {
  if (mode === "url_tags_only") {
    return [
      "Yeni kreatif oluşturulup mevcut reklama bağlanacak; reklam kimliği korunur.",
      "Aynı gönderi (object_story_id) korunur; beğeni ve yorumlar (etkileşimler) korunur.",
      "Yalnızca UTM (url_tags) değişir.",
    ];
  }
  if (mode === "revert_bind") {
    return [
      "Reklam önceki kreatif kimliğine yeniden bağlanır.",
      "Yeniden inceleme olasılığı vardır.",
    ];
  }
  // spec_patch → yeni unpublished gönderi
  return [
    "Yeni kreatif oluşturulup mevcut reklama bağlanacak; reklam kimliği korunur.",
    "Yeni gönderi oluşur: beğeni ve yorumlar taşınmaz, reklam yeniden incelemeye girer.",
  ];
}

export function isK2aCreativeChangeField(field: string): boolean {
  return (K2A_CREATIVE_FIELDS as readonly string[]).includes(field);
}

export function getCreativeEditMeta(
  payload: AdChangePayload,
): CreativeEditMeta | null {
  const raw = payload.creative;
  if (!raw || typeof raw !== "object") return null;
  return raw as unknown as CreativeEditMeta;
}

export function storedNewCreativeIdFromStepResult(
  result: unknown,
): string | null {
  if (!result || typeof result !== "object") return null;
  const id = (result as { newCreativeId?: unknown }).newCreativeId;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

export {
  classifyCreativeShape,
  classifyAndVerdict,
  UnsupportedCreativeShapeError,
  creativeBodiesEqual,
  diffCreativeWriteBodies,
  assertOnlyAllowedDiffs,
};
