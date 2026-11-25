# Google Ads analiz — Aşama 0 raporu

**Dal:** `wip/google-ads-analiz` (main’den)  
**Tarih:** 2026-11-14  
**Durum:** Envanter + auction insight **token bekliyor**. Bu dosya doğrulamalar, erişim adımları, sekme matrisi, lookback ve satır tahmini yöntemini kilitler.

---

## 1. API sürümü kararı (resmi kaynak)

Kaynak: [Deprecation and sunset](https://developers.google.com/google-ads/api/docs/sunset-dates)

| Sürüm | Yayın | Sunset |
|---|---|---|
| **v25** (kodda kullanılan) | 2026-07-22 | **Ağustos 2027** |
| v26 (güncel) | 2026-10-14 | Kasım 2027 |

Bugün: 2026-11-14 → v25 kapanışına **~9 ay** (> 6 ay).

**Karar: v25’te kal.** v26 yükseltmesi bu turda yapılmaz. Ağustos 2027’den en az 6 ay önce (yani ~Şubat 2027) planlı yükseltme.

---

## 2. “Developer token 2026’da değişti” — resmi doğrulama

Kaynak: [Developer token](https://developers.google.com/google-ads/api/docs/api-policy/developer-token) (sunset **9 Eylül 2026**)

**Ne değişti**
- Developer token’lar sunset edildi; erişim seviyesi artık **Google Cloud project**’e bağlı (OAuth client / service account’un olduğu proje).
- Header’da `developer-token` göndermek **isteğe bağlı**; sunucu **yok sayar**.
- Yeni erişim başvuruları Cloud Console → Google Ads API Overview üzerinden.
- İleride bir major sürümde token gönderimi reddedilebilir (doküman: “future major version”).

**Mevcut senkronizasyonumuzu etkiliyor mu?**
- **Hayır, şu an bozmaz.** Kod `GOOGLE_ADS_DEVELOPER_TOKEN` göndermeye devam edebilir; yok sayılır.
- **Kritik olan:** OAuth’un üretildiği Cloud projesinin production erişim seviyesi (Explorer / Basic / Standard). Yanlış proje → `CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION` / `AUTHORIZATION_ERROR`.
- Salt okunur kullanıcı için **aynı onaylı Cloud project** OAuth client’ını kullanmak en güvenlisi (yeni project = yeniden erişim başvurusu riski).

---

## 3. Senin yapman gerekenler — salt okunur API kullanıcısı

Amaç: Yönetici (MCC) hesabına **Read-only** erişimli ayrı bir Google kullanıcısı; onun refresh token’ı ile yalnızca `googleAds:search`.

### Adımlar

1. **Ayrı Google hesabı** oluştur (ör. `ads-readonly@…`). Kişisel admin hesabı kullanma.
2. **Google Ads MCC**’de: Araçlar → Erişim ve güvenlik → Kullanıcılar → **+**  
   - E-posta: yeni hesap  
   - Erişim düzeyi: **Salt okunur (Read-only)**  
   - Mümkünse MCC seviyesinde ekle (alt hesaplar görünür olsun).
3. Daveti **yeni hesapla kabul et**; Ads arayüzünde müşteri hesaplarını salt okunur görebildiğini doğrula.
4. **OAuth client (mevcut Cloud project)**  
   - Mümkünse bugün production sync’in kullandığı **aynı** `GOOGLE_CLIENT_ID` / `SECRET` (erişim seviyesi taşınmış proje).  
   - OAuth consent’te test kullanıcısı olarak `ads-readonly@…` ekli olsun (app “Testing” ise zorunlu).  
   - Scope: `https://www.googleapis.com/auth/adwords`  
   - Redirect: OAuth Playground kullanıyorsan `https://developers.google.com/oauthplayground`
5. **Refresh token al** ([OAuth Playground rehberi](https://developers.google.com/google-ads/api/docs/oauth/playground)):  
   - Gear → “Use your own OAuth credentials”  
   - Access type: **Offline**  
   - Google Ads API → `adwords` scope → Authorize (**salt okunur hesapla** giriş)  
   - “Exchange authorization code for tokens” → **Refresh token**’ı kopyala  
6. Bana / ortama ver (prod secret’ları chat’e yapıştırma; lokal `.env.local` veya güvenli kanal):  
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (mevcut proje)  
   - `GOOGLE_REFRESH_TOKEN_READONLY=<yeni refresh token>`  
   - `GOOGLE_ADS_LOGIN_CUSTOMER_ID=<MCC id, tire’siz>`  
   - `GOOGLE_ADS_DEVELOPER_TOKEN` isteğe bağlı (gönderilse de yok sayılır)
7. Çalıştır:  
   `npx tsx scripts/google-ads-phase0-inventory.ts`  
   → `docs/google-ads-analiz-asama-0-inventory.json` + kanal harcama payı + auction sonucu.

### Kontrol listesi
- [ ] Read-only kullanıcı MCC’de görünüyor  
- [ ] Playground’da refresh token alındı (offline)  
- [ ] Script kanal envanteri + auction satırlarını üretti  
- [ ] Mutate denemesi **yapılmayacak** (script zaten yalnızca search)

---

## 4. Plan kilitleri (onaylı değişiklikler)

| Madde | Karar |
|---|---|
| Dal | `main` → `wip/google-ads-analiz` |
| API | v25 (sunset Ağustos 2027) |
| PMax v1 | Aşama 0 harcama payına göre sen karar vereceksin |
| Tamamlanmadı rozeti | Varsayılan **7 gün**, marka ayarı |
| Auction CSV | Erişim yoksa **v1’e basit yükleme** |
| Live GAQL kaldırma | **Aşama 2 bitince** (Aşama 1’de değil) |
| Change history collect | **Aşama 1** (yalnız veri); UI/marker **Aşama 4** |
| Detay UI | **Staff**; müşteri `/google`’a bu turda sekme yok |
| Change history + ölçüm sağlığı | Varsayılan **yalnız staff** |
| `GoogleAdsMetric` yeni kolonlar | Mevcut ekran/rapor çıktısını değiştirmesin (testle) |

---

## 5. Staff sekmeleri — “müşteriye açılabilir mi?”

Bu turda tümü staff analiz yüzeyinde. Müşteri `/google` genişletilmez.

| Sekme / yüzey | Staff v1 | Müşteriye açılabilir mi? (karar senin) | Not |
|---|---|---|---|
| Hesap / kampanya özeti | Evet | **Aday — evet** | Bugünkü `/google` KPI’ya yakın |
| Kampanya listesi + drill (AG → reklam/kelime) | Evet | **Aday — evet** | Hiyerarşi |
| Anahtar kelimeler | Evet | **Aday — evet** | Search |
| Arama terimleri | Evet | **Aday — evet** | Search |
| Negatif kelimeler | Evet | **Aday — dikkat** | Strateji hassas olabilir |
| TBM kırılımları (cihaz/saat) | Evet | **Aday — evet** | |
| Dönüşümler (metrik + aksiyon) | Evet | **Aday — evet** | CPA aksiyon kırılımında API’de yok |
| Ölçüm sağlığı | Evet | **Hayır (varsayılan staff)** | |
| Gösterim payı (kayıp IS) | Evet | **Aday — evet** | |
| Auction insight / CSV | Evet | **Aday — dikkat** | Rakip verisi |
| Yerleşim / cihaz / konum / ağ | Evet | **Aday — evet** | |
| Değişiklik geçmişi | Evet (UI Aşama 4) | **Hayır (varsayılan staff)** | |
| Teklif + bütçe + primary status | Evet | **Aday — evet** | |
| Reklamlar / politika / RSA | Evet | **Aday — evet** | |
| Açılış sayfası | Evet | **Aday — evet** | |
| PMax öğe grupları | Karara bağlı | **Aday — evet** | PMax payına göre |
| Kitle / demografi | v1.1+ | **Aday — dikkat** | |
| Alışveriş ürünleri | v1.1+ | **Aday — evet** | |
| Video | v1.1+ | **Aday — evet** | |
| Arama (telefon) | v1.1+ | **Aday — evet** | |
| Öneriler / opt. score | v1.1+ | **Aday — dikkat** | |

---

## 6. Lookback önerileri

| Veri | Lookback | Gerekçe |
|---|---|---|
| Kampanya günlük (`GoogleAdsMetric`) | **720g** (mevcut) | Ajans trend / bütçe |
| Anahtar kelime günlük | **180g** | Kalite + TBM trend; conversion lag 30g yeniden çekilir; 720g satır patlatır |
| **Arama terimleri** | **90g** (senin varsayılanın) | Yüksek kardinalite; keşif için 90 yeterli |
| Cihaz / ağ / geo / placement | **90g** | Operasyonel; uzun arşiv az değer |
| Saat kırılımı | **90g**, mümkünse ENABLED veya top kampanya | 24× şişme |
| Impression share | **90g** | Toplanmaz; yakın dönem yeterli |
| Reklam / landing / RSA asset | **90g** | |
| PMax asset group / product | **90g** (PMax açılırsa) | |
| Conversion action meta | Snapshot (tarihsiz) + daily counts 720g mevcut `Conversion` | |
| Change event | API **30g**; **her gün çek, süresiz sakla** | Geri doldurma yok |
| Auction CSV | Yüklenen dosya tarihi kadar | |
| Günlük sync yeniden çekim | **30g** (mevcut `SYNC_DAILY_GOOGLE_DAYS`) | Dönüşüm gecikmesi |
| “Veri tamamlanmadı” rozeti | Varsayılan **7g**, marka ayarı | |

---

## 7. Satır tahmini (yöntem; sayılar token sonrası)

Script ölçer:
- 30g harcamalı kampanya sayısı / tip  
- Distinct keyword (REMOVED değil)  
- 7g search term satır üst sınırı  

Sonra çarpanlar (§6). Çıktı: `docs/google-ads-analiz-asama-0-inventory.json` → `rowEstimates`.

Token yokken ajans toplamı yazılamaz. Yerel DB’de mapped ~13 hesap var; code map’te ek slug’lar (bianne, fitik, turkler) da script’e dahil.

**Saat kırılımı uyarısı:** `kampanya × 90 × 24` kolayca milyon satıra gider; Aşama 2’de gerekirse kapsam daraltılır.

---

## 8. Auction insight

Script her hesapta bir kez:

```sql
SELECT campaign.name, segments.auction_insight_domain,
       metrics.auction_insight_search_impression_share
FROM campaign
WHERE segments.date DURING LAST_7_DAYS
LIMIT 10
```

- Başarılı → API yolu v1  
- `METRIC_ACCESS_DENIED` / benzeri → **basit CSV yükleme** v1 (staff)

---

## 9. Aşama 0 kalan iş

1. Read-only token’ı hazırla (§3)  
2. `npx tsx scripts/google-ads-phase0-inventory.ts`  
3. Bu dosyaya / sohbete: kanal harcama payı (özellikle **PERFORMANCE_MAX**), auction sonucu, tablo satır tahminleri  
4. PMax v1 kararı senden  
5. Sonra Aşama 1 (kampanya entity + **change_event arşiv collect**; müşteri `/google` sekmesiz; live fetch henüz kalkmaz)
