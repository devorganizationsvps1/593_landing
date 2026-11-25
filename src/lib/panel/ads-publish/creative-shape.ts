/**
 * K2a kreatif şekil sınıflandırıcı + destek matrisi.
 * Kaynak: Marketing API AdCreative / ObjectStorySpec / LinkData (v25–v27).
 */
import { stableStringify } from "@/lib/panel/ads-publish/write-kinds";

export type CreativeShape =
  | "single_image_link"
  | "video"
  | "carousel"
  | "asset_feed"
  | "catalog"
  | "existing_post"
  | "unknown";

export type CreativeShapeVerdict = {
  shape: CreativeShape;
  k2aEditable: boolean;
  /** K2a modu: spec_patch | url_tags_only | null */
  k2aMode: "spec_patch" | "url_tags_only" | null;
  lockReason: string | null;
  code: "ok" | "unsupported_creative_shape";
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

export type CreativeRawForShape = {
  object_story_id?: string | null;
  effective_object_story_id?: string | null;
  object_story_spec?: unknown;
  asset_feed_spec?: unknown;
  degrees_of_freedom_spec?: unknown;
  product_set_id?: string | null;
  template_url?: string | null;
  object_type?: string | null;
  video_id?: string | null;
};

/** Graph kreatif → şekil. */
export function classifyCreativeShape(
  creative: CreativeRawForShape,
): CreativeShape {
  if (creative.asset_feed_spec) return "asset_feed";

  const spec = asRecord(creative.object_story_spec);
  const templateData = asRecord(spec?.template_data);
  if (
    templateData ||
    str(creative.product_set_id).trim() ||
    str(creative.template_url).trim()
  ) {
    return "catalog";
  }

  const linkData = asRecord(spec?.link_data);
  const videoData = asRecord(spec?.video_data);
  const photoData = asRecord(spec?.photo_data);
  const children = linkData?.child_attachments;
  if (Array.isArray(children) && children.length >= 2) return "carousel";

  if (videoData || str(creative.video_id).trim()) return "video";

  const objectStoryId =
    str(creative.object_story_id).trim() ||
    str(creative.effective_object_story_id).trim();
  const hasInline =
    Boolean(linkData) || Boolean(videoData) || Boolean(photoData);

  if (objectStoryId && !hasInline) return "existing_post";

  if (linkData) {
    const hash = str(linkData.image_hash).trim();
    const picture = str(linkData.picture).trim();
    if (hash || picture) return "single_image_link";
    // link_data var ama görsel yok → bilinmeyen (metin-only / bozuk)
    return "unknown";
  }

  if (photoData) return "unknown"; // photo_data K2a dışı
  return "unknown";
}

export const CREATIVE_SHAPE_LABEL: Record<CreativeShape, string> = {
  single_image_link: "Tek görsel bağlantı",
  video: "Video",
  carousel: "Carousel",
  asset_feed: "Asset feed / çoklu varyasyon",
  catalog: "Katalog / dinamik ürün",
  existing_post: "Mevcut gönderi",
  unknown: "Bilinmeyen / desteklenmeyen",
};

export function verdictForShape(shape: CreativeShape): CreativeShapeVerdict {
  if (shape === "single_image_link") {
    return {
      shape,
      k2aEditable: true,
      k2aMode: "spec_patch",
      lockReason: null,
      code: "ok",
    };
  }
  if (shape === "existing_post") {
    return {
      shape,
      k2aEditable: true,
      k2aMode: "url_tags_only",
      lockReason: null,
      code: "ok",
    };
  }
  const label = CREATIVE_SHAPE_LABEL[shape];
  return {
    shape,
    k2aEditable: false,
    k2aMode: null,
    lockReason: `K2a bu kreatif türünü düzenlemez: ${label}. Ads Manager veya sonraki kademe (K2b) kullanın.`,
    code: "unsupported_creative_shape",
  };
}

export function classifyAndVerdict(
  creative: CreativeRawForShape,
): CreativeShapeVerdict {
  return verdictForShape(classifyCreativeShape(creative));
}

/**
 * Create/yazma için anlamlı alanları normalize et (salt okunur alanlar çıkar).
 * Diff ve read-back aynı normalize’ı kullanır.
 */
export const CREATIVE_WRITE_TOP_KEYS = [
  "object_story_spec",
  "object_story_id",
  "url_tags",
  "instagram_user_id",
  "degrees_of_freedom_spec",
  "image_hash",
  "image_crops",
  "video_id",
  "authorization_category",
  "use_page_actor_override",
  "applink_treatment",
  "platform_customizations",
  "asset_feed_spec",
  "product_set_id",
  "template_url",
  "template_url_spec",
  "call_to_action_type",
  "actor_id",
] as const;

const READ_ONLY_DROP = new Set([
  "id",
  "account_id",
  "status",
  "thumbnail_url",
  "thumbnail_id",
  "effective_object_story_id",
  "effective_instagram_media_id",
  "effective_authorization_category",
  "instagram_permalink_url",
  "object_type",
  "body",
  "title",
  "image_url",
  "name", // create’te yeni name veriyoruz; karşılaştırmada ignore
]);

export function stripReadOnlyCreativeFields(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (READ_ONLY_DROP.has(k)) continue;
    if (v === undefined || v === null || v === "") continue;
    out[k] = v;
  }
  return out;
}

/** Deep sort + drop empty for stable compare. */
export function normalizeCreativeValue(value: unknown): unknown {
  if (value === null || value === undefined || value === "") return undefined;
  if (Array.isArray(value)) {
    const arr = value
      .map((v) => normalizeCreativeValue(v))
      .filter((v) => v !== undefined);
    return arr.length ? arr : undefined;
  }
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(rec).sort()) {
      const n = normalizeCreativeValue(rec[k]);
      if (n !== undefined) out[k] = n;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return value;
}

export function normalizeCreativeWriteBody(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const stripped = stripReadOnlyCreativeFields(body);
  const norm = normalizeCreativeValue(stripped);
  return (norm && typeof norm === "object" && !Array.isArray(norm)
    ? norm
    : {}) as Record<string, unknown>;
}

export function creativeBodiesEqual(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  return (
    stableStringify(normalizeCreativeWriteBody(a)) ===
    stableStringify(normalizeCreativeWriteBody(b))
  );
}

/**
 * Beklenen create body ile okunan kreatiften türetilen write body farkı.
 * `allowedPathPrefixes` dışındaki fark → koruma ihlali.
 */
export function diffCreativeWriteBodies(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const paths: string[] = [];
  walkDiff(
    normalizeCreativeWriteBody(before),
    normalizeCreativeWriteBody(after),
    "",
    paths,
  );
  return paths;
}

function walkDiff(
  a: unknown,
  b: unknown,
  path: string,
  out: string[],
): void {
  if (stableStringify(a) === stableStringify(b)) return;
  const aObj = asRecord(a);
  const bObj = asRecord(b);
  if (aObj && bObj) {
    const keys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
    for (const k of keys) {
      walkDiff(aObj[k], bObj[k], path ? `${path}.${k}` : k, out);
    }
    return;
  }
  out.push(path || "(root)");
}

/** K2a’nın bilerek değiştirebileceği path önekleri. */
export const K2A_ALLOWED_DIFF_PREFIXES = [
  "url_tags",
  "object_story_spec.link_data.message",
  "object_story_spec.link_data.name",
  "object_story_spec.link_data.description",
  "object_story_spec.link_data.link",
  "object_story_spec.link_data.call_to_action",
] as const;

export function isAllowedK2aDiffPath(path: string): boolean {
  return K2A_ALLOWED_DIFF_PREFIXES.some(
    (p) => path === p || path.startsWith(`${p}.`),
  );
}

export function assertOnlyAllowedDiffs(paths: string[]): void {
  const bad = paths.filter((p) => !isAllowedK2aDiffPath(p));
  if (bad.length) {
    throw new Error(
      `Kreatif fark koruması: beklenmeyen alan değişimi: ${bad.slice(0, 8).join(", ")}`,
    );
  }
}

export class UnsupportedCreativeShapeError extends Error {
  readonly code = "unsupported_creative_shape" as const;
  constructor(
    message: string,
    readonly shape: CreativeShape,
  ) {
    super(message);
    this.name = "UnsupportedCreativeShapeError";
  }
}
