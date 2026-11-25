# K2a doğrulama raporu (K2c / K2b yok)

Tarih: 2026-11-16 (sertleştirme sonrası). Kaynak: `creative-shape.ts`, `creative-edit.ts`, `write.ts` CREATIVE_EDIT_FIELDS, job-runner, MetaPublishBoard, orphan UI, `scripts/report-meta-creative-shapes.ts` + Marketing API v25–v27.

**Özet:** 1–7 yerelde kapatıldı; `k2a-creative.test.ts` **23** sahte-yanıt testiyle yeşil (şekil başına ret, IG/DOF/crop ayrı, read-back→bind/orphan, DISAPPROVED bildirim, UTM `object_story_id`). **K2 bayrağı kapalı.** Dağıtım + K1 sonrası A–H. K2c/K2b bekliyor. Yeni özellik kodu yok — dağıtım bekleniyor.

---

## 1. Geniş okuma

`CREATIVE_EDIT_FIELDS` (`write.ts`): `object_story_spec` (tam alt ağaç), `asset_feed_spec`, `degrees_of_freedom_spec`, `instagram_user_id`, `object_story_id` / `effective_*`, `url_tags`, `image_hash` / `image_crops`, `video_id`, `product_set_id`, `template_url` / `template_url_spec`, `platform_customizations`, `authorization_category`, `use_page_actor_override`, `applink_treatment`, `call_to_action_type`, …

`extractWriteExtras` create body’ye üst düzey write alanlarını kopyalar (IG, DOF, crops üst düzey, vb.).

---

## 2. Şekil sınıflandırıcı

| Tür | `CreativeShape` | K2a |
|---|---|---|
| Tek görsel link | `single_image_link` | `spec_patch` |
| Mevcut gönderi | `existing_post` | yalnızca `url_tags_only` |
| Video / carousel / asset_feed / catalog / unknown | … | Kilit + `unsupported_creative_shape` |

UI: kilit bandı + neden. Paket create/update: `assertK2aCreativePayload`. Job create: aynı red kodu.

---

## 3. Fark koruması

Normalize + `diffCreativeWriteBodies` → yalnızca `K2A_ALLOWED_DIFF_PREFIXES` (metin/URL/CTA/url_tags). IG / DOF / crop düşerse create öncesi ret. Test: `rejects when IG or DOF would drop`.

---

## 4. Geri okuma

Create → Graph’tan oku → `assertReadBackMatchesExpected`. Uyuşmazlık: bind yok, step `failed`, `MetaOrphanCreative` (`readback_mismatch`).

---

## 5. Uyarılar

- `spec_patch`: “beğeni ve yorumlar taşınmaz, reklam yeniden incelemeye girer”
- `url_tags_only`: “gönderi ve etkileşimler korunur” (taşınmaz yok)

---

## 6. İnceleme durumu

Bind sonrası `effective_status` + `ad_review_feedback` → paket `metaReviewStatus` / `metaReviewFeedback`. UI’da etiket. `DISAPPROVED` / `WITH_ISSUES` → panel bildirimi.

---

## 7. Sahipsiz kreatifler

Model `MetaOrphanCreative`; staff `/meta-sahipsiz`; API `GET/PATCH /api/panel/ads-publish/orphans`. Kayıt: readback / bind fail / bind verify fail.

---

## 8. Envanter betiği (operatör)

```bash
DATABASE_URL=… META_SYSTEM_USER_TOKEN=… npx tsx scripts/report-meta-creative-shapes.ts [tenantSlug]
```

ACTIVE reklamlar → şekil sayısı + harcama payı. V2 prod sonrası çalıştırılır; K2 öncelikleri buna göre.

---

## Bitti ölçütü skoru (yerel)

| # | Ölçüt | Durum |
|---|---|---|
| 1 | Geniş okuma + kopya | **Tamam** (yerel) |
| 2 | Desteklenmeyen türler kilit + red | **Tamam** (yerel) |
| 3 | Fark koruması | **Tamam** (yerel) |
| 4 | Create read-back + orphan | **Tamam** (yerel) |
| 5 | Senaryo uyarıları | **Tamam** (yerel) |
| 6 | Review sync + bildirim | **Tamam** (yerel) |
| 7 | Staff orphan liste | **Tamam** (yerel) |
| 8 | Envanter betiği | **Hazır** (henüz prod’da çalıştırılmadı) |
| A–H | Gerçek hesap | **Bekliyor** (K1 sonrası) |

**Kapı:** K2 bayrağı K1 gerçek hesap + A–H olmadan açılmaz.

K2c / K2b: **bekliyor.**
