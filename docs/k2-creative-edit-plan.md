# K2 — Kreatif düzenleme + reklam seti takvimi (rapor / plan)

**Kapsam:** mevcut reklamda ana metin, başlık, açıklama, CTA, URL, UTM, görsel/video değiştirme; reklam seti `start_time` / `end_time` / `adset_schedule`.  
**Bu belge:** yalnızca rapor + plan. Kod yok. Kaynak: Marketing API v25–v27 referansları ([AdCreative](https://developers.facebook.com/docs/marketing-api/reference/adcreative/), [Ad](https://developers.facebook.com/docs/marketing-api/reference/adgroup/), [Ad Set](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-campaign/), [Object Story Spec](https://developers.facebook.com/docs/marketing-api/reference/ad-creative-object-story-spec/), [social feedback](https://developers.facebook.com/ads/blog/post/v2/2017/07/18/transfering-reactions/), [pacing/schedule](https://developers.facebook.com/docs/marketing-api/bidding/overview/pacing-and-scheduling/)).

K1 ile aynı iskelet: paket → onay önizleme (fingerprint + canlı Graph) → job adımları (`AdChangeStep` idempotency) → `graphPost` only. K2 bayrağı (`metaAdsWriteTierK2`) flags-off deploy’da kapalı kalır.

---

## 1. Hangi alanlar yerinde değişir? Hangisi yeni kreatif ister?

### AdCreative üzerinde doğrudan güncellenebilir (POST `/{creative_id}`)

Resmi Update parametreleri yalnızca:

| Alan | Not |
|---|---|
| `name` | Kütüphane görünen adı (≤100) |
| `status` | ACTIVE / IN_PROCESS / WITH_ISSUES / DELETED |
| `adlabels` | Etiketler |
| `account_id` | Hesap bağlamı |

**İçerik alanları update listesinde yok:** `object_story_spec` (message, name/headline, description, link, CTA, image_hash, video_id, child_attachments), `object_story_id`, `url_tags`, asset feed / template alanları. Bunlar **yeni AdCreative oluşturup** reklamı yeniden bağlamayı gerektirir.

### Reklam (Ad) üzerinden

```http
POST /{ad_id}
creative={"creative_id":"<YENİ_CREATIVE_ID>"}
```

- Aynı `ad_id` / ad set / bütçe / targeting korunur.
- Alternatif: inline `creative={...object_story_spec...}` — yine yeni kreatif + (çoğu durumda) yeni unpublished post üretir; K2’de **tercih edilen yol ayrı create + creative_id bağlama** (adım idempotency ve audit için).

### URL / UTM

- UTM genelde kreatif `url_tags` (veya link içi query). `url_tags` create-time; yerinde creative update yok → **yeni kreatif + rebind**.
- Yalnızca `url_tags` değişimi, medya/metin aynı kalsa bile yeni kreatif gerekir.

### Reklam seti takvimi (Ad Set — yerinde update)

| Alan | API | Kısıt |
|---|---|---|
| `start_time` | POST `/{adset_id}` | Teslimat başladıktan sonra değiştirilemez (ör. 100/1487101) |
| `end_time` | POST `/{adset_id}` | Gelecekte olmalı; lifetime bütçede zorunlu; daily’de `0` = süresiz |
| `adset_schedule` | + genelde `pacing_type=["day_parting"]` | `start_minute`/`end_minute` saat hizalı, ≥1 saat; günler 0–6 |

Takvim **yeni kreatif gerektirmez**; tek Graph update.

### Özet matris (K2 kapsamı)

| Değişiklik | Yerinde? | Yol |
|---|---|---|
| Kreatif `name` / status / labels | Evet | Creative update (K2 ürün kapsamı dışı — opsiyonel) |
| Ana metin, başlık, açıklama, CTA, link | Hayır | Create creative → ad.creative_id |
| UTM (`url_tags`) | Hayır | Aynı |
| Görsel / video | Hayır | Aynı (+ gerekirse adimages/advideos upload) |
| Post tabanlı (`object_story_id`) metin/medya | Hayır* | Aşağı §3 |
| Ad set start/end/daypart | Evet | Ad set update |

\*Page post’u Page API ile düzenlemek ayrı yüzey; K2 Ads yazımında varsayılan değil.

---

## 2. Yan etkiler (inceleme, etkileşim, öğrenme)

| Değişiklik türü | Yeniden inceleme | Beğeni/yorum (social proof) | Öğrenme (ad set learning) |
|---|---|---|---|
| Metin / başlık / açıklama / CTA (aynı medya, `object_story_spec` → yeni kreatif) | Genelde evet (`PENDING_REVIEW`) | Meta, **inline unpublished** post’larda feedback taşımayı destekler; medya değişmezse çoğu durumda korunur | Küçük metin/URL genelde “significant edit” sayılmaz; garanti yok — uyarı göster |
| URL / `url_tags` only | Sıklıkla hafif; yine review’a girebilir | Medya aynıysa feedback taşınması beklenir | Genelde düşük etki; yine de uyarı |
| Görsel veya video değişimi | Evet | Meta: tek görsel/video veya carousel kartında medya değişince **feedback taşınmaz** | Yüksek risk — learning reset / yeniden keşif uyarısı |
| Dynamic / catalog (`template_data`) | — | Feedback taşınmaz; K2’de **destekleme** (katalog/feed’e yönlendir) | — |
| Aynı kreatif birden fazla reklama bağlı / yayınlanmış post | — | Feedback taşıma limitleri (Meta blog) | — |
| Ad set `end_time` / daypart | Hayır (kreatif review yok) | Yok | Genelde düşük; süre/lifetime bütçe ilişkisine dikkat |
| Ad set `start_time` (henüz başlamamış) | Hayır | Yok | Yok |
| Reklamı silip yeniden yaratmak | — | **Kaybedilir** | **Kaybedilir** — K2’de yasak |

Ürün kuralı: her onay önizlemesinde yan etki seviyesini (düşük / orta / yüksek) göster; medya değişiminde “etkileşim sıfırlanabilir + öğrenme etkilenebilir” zorunlu onay metni.

---

## 3. Mevcut gönderi (post) vs panelde oluşturulan kreatif

| Tür | Nasıl tanınır | Düzenlenebilirlik (K2) |
|---|---|---|
| **Existing post / boosted** | Creative’da `object_story_id` set; `object_story_spec` çoğu zaman yok; `effective_object_story_id` = post | Metin/medya **Ads creative update ile yerinde yok**. Seçenekler: (A) yalnızca `url_tags`’li **yeni** kreatif + aynı `object_story_id` (post içeriği aynı kalır); (B) yeni `object_story_spec` kreatif (yeni unpublished post — social proof parçalanır / taşıma kurallarına bağlı); (C) Page post edit (K2 dışı). **Varsayılan: A destekle; B’de sert uyarı; C yok.** |
| **Ads Manager / API unpublished** | `object_story_spec` (link_data / video_data / …); `effective_object_story_id` sonradan dolu | Standart yol: spec’i kopyala → alanları patch → `POST act_…/adcreatives` → ad’e bağla. |
| **Carousel / multi-card** | `child_attachments[]` | Desteklenebilir ama kart indeksi patch; ilk sürümde K2b’ye ertele veya “yalnızca tek görsel/video + link” ile sınırla. |
| **DPA / Advantage+ catalog** | `template_data` / asset feed | K2 **out of scope** — paket oluşturmayı reddet. |

Okuma alanları (önizleme + bayatlık):  
`creative{id,name,object_story_id,effective_object_story_id,object_story_spec,url_tags,thumbnail_url,image_hash,video_id}` (+ ad `creative`).

---

## 4. Çok adımlı işlem: idempotency, kurtarma, geri alma

### Kreatif değişikliği (2 Graph yazması)

1. `POST act_{ad_account_id}/adcreatives` → `new_creative_id`  
2. `POST /{ad_id}` `creative={creative_id:new_creative_id}`

| Durum | Tespit | Kurtarma | Geri alma |
|---|---|---|---|
| 1 başarısız | Step1 `failed`; ad eski kreatifte | Retry Step1 (yeni idempotency key veya aynı key + henüz creative yok) | Yapılacak bir şey yok |
| 1 OK, 2 fail / timeout | Step1 `succeeded` + `resultJson.new_creative_id`; Step2 failed/unknown | **Replay Step2 only** aynı `new_creative_id` ile (create tekrarlama). Orphan creative hesapta kalabilir — silme opsiyonel, zorunlu değil | Ad hâlâ eski creative_id’de → kullanıcıya “uygulanmadı” |
| 1+2 OK, local DB fail | Meta güncel, paket `partial`/`failed` | Sync ad → fingerprint doğrula; job’u `applied` işaretle | — |
| İkisi de OK, kullanıcı pişman | — | **Otomatik undo yok** (Meta creative içerik immutable). Telafi: eski `creative_id`’yi sakla → “önceki kreatife dön” paketi (yine rebind, review riski) | Eski id’yi `AdChangeStep.resultJson` + version snapshot’ta tut |

**Idempotency (K1 deseni):**

- Step key: `pkg:{id}:v:{n}:create_creative:{ad_id}` → creatives create.  
- Step key: `pkg:{id}:v:{n}:bind_creative:{ad_id}` → ad update.  
- Create bir kez başarı yazıldıysa aynı key ile **yeniden create etme**; stored `creative_id` ile bind’e geç.  
- Bind tekrarında Meta’ya aynı `creative_id` POST etmek güvenli (no-op / success).

**Takvim:** tek step `update_adset_schedule:{adset_id}` — yarım kalma yok; retry idempotent (aynı end_time/schedule body).

**Paket status:** K1’deki `partial` — Step1 done / Step2 not → UI “Kreatif oluştu, reklama bağlanamadı — yeniden dene (bağlama)”.

---

## 5. Bayatlık kontrolü — hangi alanlar?

Onay anında canlı Graph vs paket fingerprint (K1 approval-preview ile aynı kapı). K2 alanları:

### Reklam / kreatif

- `ad.id`, `ad.effective_status` / `status`
- `ad.creative.creative_id` (bağlı kreatif)
- Normalized creative payload hash:
  - `object_story_id` / `effective_object_story_id`
  - `object_story_spec.link_data|video_data|photo_data`: `message`, `name`, `description`, `link`, `call_to_action`, `image_hash`, `video_id`, `child_attachments` (özet)
  - `url_tags`
- `thumbnail_url` veya image hash (görsel doğrulama)

### Reklam seti (takvim paketi)

- `adset.id`, `effective_status`
- `start_time`, `end_time`
- `adset_schedule` (+ `pacing_type` day_parting ise)
- Lifetime ise `lifetime_budget` varlığı (end_time zorunluluğu için — değer K1 bütçe değilse bile tutarlılık)

### Ortak

- Hesap `currency` / `Tenant.metaCurrency` (gösterim; takvimde blok şart değil)
- Ownership: reklam/adset tenant sync penceresinde

Uyuşmazlık → onay reddi; yeniden sync + yeni önizleme.

**Bayatlık dışı (bilinçli):** like/comment sayıları, learning_stage_info anlık değeri (uyarı için okunabilir, fingerprint’e koyma).

---

## 6. Önizleme UI — eski | yeni + uyarılar

Tek modal (K1 bütçe önizlemesi gibi), yan yana:

| Sol (canlı mevcut) | Sağ (önerilen) |
|---|---|
| Thumbnail / video poster | Yeni medya veya “aynı” |
| Ana metin, başlık, açıklama | Diff vurgulu yeni metinler |
| CTA + görünür URL | Yeni CTA / URL |
| UTM (`url_tags`) | Yeni tag string |
| Post tipi: “Mevcut gönderi” / “Panel kreatifi” | Yol etiketi (rebind / url_tags only) |
| Ad set: start–end + daypart özeti | Yeni takvim |

**Uyarı bandı (zorunlu metinler):**

1. “Yeni kreatif oluşturulup reklama bağlanacak; kreatif içeriği yerinde güncellenmez.”  
2. Medya değişiyorsa: “Beğeni/yorum sıfırlanabilir; öğrenme süreci etkilenebilir; yeniden inceleme beklenir.”  
3. Post-ID reklam + spec’e geçiş: “Yeni unpublished gönderi oluşur; mevcut gönderi etkileşimi paylaşılmayabilir.”  
4. `start_time` geçmiş/teslimatta: alan kilitli + neden.  
5. Catalog/DPA: paket oluşturulamaz.

Onay = fingerprint imzası + bu uyarıların kabulü (medya için checkbox).

---

## 7. Görsel / video kaynağı (kreatif kütüphanesi yok)

Bu sürümde panel “kreatif kütüphanesi” yok. En basit güvenli seçenekler (öncelik sırası):

1. **Hesaptaki mevcut medya (önerilen varsayılan)**  
   - `GET act_{id}/adimages` → `hash` + url  
   - `GET act_{id}/advideos` → `id`  
   - Kullanıcı listeden seçer; create creative’da `image_hash` / `video_id` reuse.  
   - Avantaj: upload yetkisi/min-type riski düşük; orphan dosya yok; tekrarlanabilir.

2. **Dosya yükleme (ikincil)**  
   - `POST act_{id}/adimages` (multipart) / video upload flow → hash/id al → creative create.  
   - Sınır: boyut/tip validasyonu, timeout, yarım upload; K2b’de feature-flag ile.

3. **URL’den picture** — API’de mümkün ama kırılgan (hotlink); **K2’de önerme**.

4. **Panel içi asset DB / S3 kütüphane** — sonraki sürüm; K2 kapsamı dışı.

**Güvenli MVP:** yalnızca (1); metin/URL (K2a) medya istemez. K2b açılınca (1) zorunlu UI, (2) opsiyonel.

---

## 8. Alt kademeler ve bitti ölçütü

### K2a — Metin + URL/UTM (+ CTA tipi) — **uygulandı**

- **Dahil:** message, headline (`name`), description, CTA type/link, link, `url_tags`.  
- **Hariç:** image/video swap, carousel kart medyası, takvim, catalog.  
- **Post-ID reklamlar:** varsayılan `url_tags_only` (aynı `object_story_id`); copy → açık **Post → spec** checkbox (medya şart, K2b).  
- **Bitti ölçütü:**
  - [x] Canlı creative okuma + normalize + fingerprint (`/api/panel/ads-publish/creative`)
  - [x] Önizleme yan yana + review/engagement uyarıları
  - [x] Job: `creative.create` → `creative.bind`; saklı `newCreativeId`; revert ayrı paket
  - [x] Bayatlık: fingerprint + creative_id (önizleme + apply)
  - [x] Flags: `metaAdsWriteTierK2` + allowlist yalnız K2a (media/schedule deferred)
  - [x] Test: `k2a-creative.test.ts` (bayat fp, çift onay tek job, stored id)
  - [ ] Meta hata mesajı map (create/bind) — sonraki cilâ

### K2b — Görsel / video

- **Dahil:** image_hash / video_id değişimi; upload opsiyonel.  
- **Üzerine:** K2a metin alanları aynı pakette birleşebilir.  
- **Bitti ölçütü:**
  - [ ] Ad account medya listesi UI (hash/id seçimi)
  - [ ] Medya değişiminde yüksek yan etki uyarısı + checkbox
  - [ ] Feedback-reset ve learning uyarısı kopyası sabit
  - [ ] Carousel: ya kart-düzeyi ya “out of scope”
  - [ ] Orphan creative / failed bind runbook
  - [ ] Upload varsa: tip/boyut validasyon + step ayrı idempotency

### K2c — Reklam seti takvimi

- **Dahil:** `end_time`, `adset_schedule` (+ day_parting), henüz başlamamışsa `start_time`.  
- **Hariç:** bütçe (K1), targeting, status pause/unpause (ayrı kind ise).  
- **Bitti ölçütü:**
  - [ ] Canlı adset schedule fingerprint
  - [ ] start_time kilit kuralları (teslimat sonrası)
  - [ ] lifetime ↔ end_time tutarlılık kontrolü
  - [ ] Tek step apply + retry
  - [ ] Önizleme: eski/yeni zaman çizelgesi
  - [ ] Completeness: sync’te start/end/schedule alanları saklanıyorsa UI’da göster

### Sıra önerisi

`K2a → K2c → K2b` (takvim tek yazma, medyadan basit; medya en yüksek yan etki).  
İstersen `K2a → K2b → K2c`; takvim bağımsız ship edilebilir.

### Bilinçli out of scope (tüm K2)

- Kreatif kütüphanesi / S3 asset browser  
- Page post içeriğini Page API ile düzenleme  
- Catalog/DPA template edit  
- Advantage+ creative asset groups karmaşık edit  
- Otomatik “undo” (yalnızca eski creative_id’ye manuel rebind paketi)  
- Reklam silip yeniden yaratma

---

## Uygulama notları (kod yazılmadan bağlar)

- Kind’ler (ör.): `meta.ad.creative_rebind`, `meta.adset.schedule` — paket version `ops[]` içinde.  
- Write gate: global `META_ADS_WRITE` + tenant `metaAdsWriteEnabled` + `metaAdsWriteTierK2`.  
- Sync: kreatif alanları ve adset schedule’ın DB’de tutulması bayatlık/önizleme için gerekli; eksikse her onayda canlı Graph zorunlu (K1 preview gibi).  
- `(d)` / K1 prod doğrulaması bitmeden K2 bayrağı açılmamalı.
