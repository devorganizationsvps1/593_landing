# Ads publish — Dokploy dağıtım runbook (kopyala-yapıştır)

**Bu dosya yalnızca senin çalıştırman içindir.** Agent prod’da komut çalıştırmaz.

| Sürüm | Git etiketi | Commit (tam) | Migration’lar |
|---|---|---|---|
| **V1** | `ads-publish-prod-dryrun-1` | `a85dde8d0ae1bd0717a9a9534b9f958164185813` | `20261114120000` packages, `…191000` idempotency, `…193000` write_gates, `…210000` panel_notice |
| **V2** | `ads-publish-prod-dryrun-2` | `ad13b08935e173e1d1657e48f4fed4664f3a8cf0` | V1 + `…220000` MetaCampaign/AdSet, `…223000` approval previewJson, `…230000` Tenant.metaCurrency |

Dokploy `start` = `prisma migrate deploy && next start` (`package.json`). Redeploy migration’ı boot’ta uygular (`nixpacks.toml`). **Başarısız migration → panel hiç açılmaz** (P3009/P3018).

Erişim: Meta yayın / sahipsiz / google-analiz şimdilik **yalnızca Muhammet** (`ADS_PUBLISH_PEOPLE`).

Yer tutucular (önce export et — genelde **sunucu SSH** veya laptop’tan prod DB URL ile):

```bash
export PROD_DATABASE_URL='postgresql://…'   # prod Postgres
export ADMIN_HOST='https://…'               # panel kök URL
export SESSION_COOKIE='…'                   # admin oturum çerezi (gerekirse)
export DUMP_DIR="$HOME/593-dumps"
mkdir -p "$DUMP_DIR"
```

K2 planı (kod değil): `docs/k2-creative-edit-plan.md`. İkinci sürüm notu: `docs/ads-publish-second-release.md`.

---

# Komutlar nerede çalışır? (Dokploy)

| Komut / iş | Nerede | Not |
|---|---|---|
| **Redeploy**, branch/commit seç, env (`META_ADS_WRITE`) | Dokploy UI → uygulama | Build + start burada |
| `prisma migrate status` / `migrate deploy` / `migrate resolve` | **Uygulama konteyneri** terminali | Node + `node_modules/prisma` var; `DATABASE_URL` genelde env’de hazır |
| `npx prisma db execute --stdin` | **Uygulama konteyneri** | `psql` yoksa SQL için bunu kullan |
| `psql`, `pg_dump`, `pg_restore` | **Veritabanı konteyneri** terminali **veya** sunucu SSH (client kuruluysa) | Uygulama imajında `psql` çoğu zaman **yok** |
| Dokploy DB Backup / Restore | Dokploy UI → **Database** servisi → Backups | Aşağıda “Yedek” |
| Panel `/yedekler` | Tarayıcı | Board snapshot; **Postgres şemasını tam yedeklemez** |

### Uygulama konteynerinde (prisma)

```bash
# Dokploy → App → Terminal (veya docker exec app)
cd /app   # veya çalışma dizini
npx prisma migrate status
npx prisma migrate deploy
# SQL (psql yoksa):
printf 'SELECT COUNT(*) FROM "_prisma_migrations";\n' | npx prisma db execute --stdin
```

### Veritabanı konteynerinde / SSH’de (psql)

```bash
# Dokploy → Postgres → Terminal  VEYA  SSH + psql client
psql "$DATABASE_URL" -c 'SELECT 1'
# veya konteyner içi:
psql -U <user> -d <db>
```

`PROD_DATABASE_URL`’yi Dokploy Postgres servisinin connection string’inden kopyala (UI → Database → Connection).

---

# Yerel migration provası (2026-11-16) — sonuçlar

Ortam: yerel Postgres (`initdb`), worktree `055b83d` (main) + `ads-publish-prod-dryrun-1` (`a85dde8`).

| # | Senaryo | Sonuç |
|---|---|---|
| **1** | main şeması → V1 `migrate deploy` | **OK** — 4 V1 migration uygulandı; `AdChange*` + `PanelNotice` oluştu |
| **2** | V1 uygulanmış DB + eski commit (`055b83d`) `migrate deploy` | **OK** — “No pending migrations”; boot’taki migrate **engel değil**. Şema additive kaldığı için geri kod açılır (yeni tablolar yerinde kalır) |
| **3** | Bilerek başarısız migration (`SELECT 1/0`) | **Her iki commit de açılmaz** — `P3018` sonra `P3009` (failed migration). `prisma migrate resolve --rolled-back <ad>` ile kurtarma → tekrar deploy OK |

Notlar:

- Başarısız denemede `CREATE TABLE` transaction içinde olduğu için kısmi tablo **kalmadı**. Non-transactional DDL (nadiren) kalırsa elle `DROP` gerekir.
- `npm run start` = migrate + next; migrate fail → **next hiç başlamaz**.
- Geri dönüşte migrate’i atlamak istersen (acil): Dokploy start komutunu geçici `npm run start:app` yap — **yalnızca** failed-migration kurtarma / bilinen şema uyumu sonrası; kalıcı yapma.

### Başarısız migration kurtarma (prod — adım adım)

**Nerede:** uygulama konteyneri terminali.

1. Log’da migration adını bul (`P3018` / `P3009` satırı).
2. Kısmi nesne var mı bak (DB terminali veya `prisma db execute`):

```bash
# Örnek: başarısız mig’in SQL’indeki CREATE TABLE adları
printf '\dt "AdChangePackage"\n' | npx prisma db execute --stdin
# veya psql:
# psql "$DATABASE_URL" -c '\dt AdChange*'
```

3a. **SQL hiç uygulanmadı / transaction geri alındı** (provadaki gibi):

```bash
npx prisma migrate resolve --rolled-back 20261114XXXXXXXX_migration_name
# kötü migration’ı commit’ten çıkar veya düzeltip yeniden deploy
npx prisma migrate deploy
# Redeploy
```

3b. **DDL kısmen kaldı ve elle tamamladın** (veya SQL’i elle düzelttin, şema artık doğru):

```bash
npx prisma migrate resolve --applied 20261114XXXXXXXX_migration_name
npx prisma migrate status   # up to date olmalı
# Redeploy (start: migrate + next)
```

3c. **Emin değilsen:** Dokploy DB yedeğinden restore → failed satırı gitmiş DB ile yeniden dene. Kör `resolve --applied` **yapma**.

Eski commit’e rollback **failed migration varken** işe yaramaz: main de `P3009` alır. Önce resolve (veya restore).

---

# Sürüm 1 — `ads-publish-prod-dryrun-1` (`a85dde8`)

## V1-1) Yedek

### A) Dokploy Database Backup (tercih)

1. Dokploy → **Postgres / Database** servisi → **Backups** (veya Schedules).
2. Manuel backup al; bitmesini bekle; dosya/snapshot ID not et.
3. **Geri yükleme doğrulama (mutlaka biri):**
   - En iyisi: yedeği **ayrı bir staging DB**’ye restore et → staging’de `psql` ile `\dt` + `SELECT COUNT(*) FROM "Tenant"` + `_prisma_migrations` satır sayısı.
   - Staging yoksa: `pg_restore --list <backup>` (veya Dokploy’un “verify/list” çıktısı) — içinde `Tenant`, `_prisma_migrations` görünmeli; boyut > 0.
4. “Restore’u prod’a basmadan” list/staging ile doğrula. Prod’a kör restore **V1 öncesi değil**, felaket anında.

Dokploy backup formatı panele göre değişir (S3 dump / volume snapshot). UI’da “Restore” varsa staging’de bir kez dene; yoksa aşağıdaki `pg_dump`’ı da al (kemer + askı).

### B) `pg_dump` (SSH veya DB konteyneri — kemer)

```bash
DUMP_FILE="$DUMP_DIR/593-pre-v1-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump "$PROD_DATABASE_URL" --format=custom --file="$DUMP_FILE"
ls -lh "$DUMP_FILE"
pg_restore --list "$DUMP_FILE" | head -20
```

| Görmen gereken | Görmezsen |
|---|---|
| `ls` dosya boyutu > 0 (genelde onlarca MB+) | Dump yolu/izin/`PROD_DATABASE_URL` yanlış — deploy etme |
| `pg_restore --list` tablo listesi (en azından `Tenant`, `_prisma_migrations`) | Dosya bozuk — yeniden `pg_dump` |

### C) Panel `/yedekler` (ek; yeterli değil)

Board snapshot — ads-publish şema yedeği **değil**. İstersen:

```bash
curl -sS -X POST "$ADMIN_HOST/api/panel/backups" \
  -H "Cookie: $SESSION_COOKIE" \
  -H "Content-Type: application/json" \
  -d '{"trigger":"manual"}'
```

Not et: Dokploy backup ID + varsa `DUMP_FILE=…`

## V1-2) Prod salt okunur kontroller → karar tablosu

```bash
git fetch --tags
git checkout ads-publish-prod-dryrun-1
git rev-parse HEAD
# beklenen: a85dde8d0ae1bd0717a9a9534b9f958164185813
```

| Görmen gereken | Görmezsen |
|---|---|
| `a85dde8…` | Yanlış etiket/commit — deploy etme |

```bash
DATABASE_URL="$PROD_DATABASE_URL" npx prisma migrate status
```

| `migrate status` çıktısı | Anlam | Ne yap |
|---|---|---|
| `Database schema is up to date!` | Dört V1 migration zaten applied | App redeploy yeterli; yine de SQL doğrula |
| Pending: `12000` / `91000` / `93000` / `21000` | Eksik additive migration | Yedek tamam → Dokploy redeploy (`migrate deploy` boot’ta) |
| Listede `20261114180000_creative_analysis_ops` | Yanlış migration | **DUR** — deploy etme |
| Applied ama local’de yok | Prod drift | `scripts/sql/prod-predeploy-decision.md` — kör `resolve` yok |
| Failed / P3005 | Kısmi/elle şema | Aynı rehber + SQL B |

```bash
psql "$PROD_DATABASE_URL" -f scripts/sql/prod-predeploy-readonly.sql
```

Karar matrisi: `scripts/sql/prod-predeploy-decision.md` (tablo/enum var + migration satırı yok → `resolve --applied`; obje yok → deploy).

## V1-3) `META_ADS_WRITE` kapalı

Dokploy → uygulama → Environment:

| Görmen gereken | Görmezsen |
|---|---|
| `META_ADS_WRITE` yok **veya** değeri `1` değil (boş / `0`) | Varsa `1` ise **deploy öncesi kaldır/0 yap** — aksi halde kapı açılabilir |

Tenant bayrakları (DB):

```bash
psql "$PROD_DATABASE_URL" -c '
SELECT COUNT(*) FILTER (WHERE "metaAdsWriteEnabled") AS write_on,
       COUNT(*) FILTER (WHERE "metaAdsWriteTierK1") AS k1,
       COUNT(*) FILTER (WHERE "metaAdsWriteTierK2") AS k2
FROM "Tenant";'
```

| Görmen gereken | Görmezsen |
|---|---|
| Hepsi `0` | Aşağıdaki acil SQL ile kapat; nedenini sor |

## V1-4) Migration + dağıtım

1. Dokploy’da branch/commit = **`ads-publish-prod-dryrun-1` / `a85dde8`**.
2. **Redeploy** (build log: `npm run build` → start: `prisma migrate deploy && next start`).
3. Health: panel login + ana sayfa 200.

| Görmen gereken | Görmezsen |
|---|---|
| Deploy success, container healthy | Build OOM → `nixpacks.toml` heap; migrate fail → log + **Rollback V1** |
| Login çalışıyor | 5xx → app log; gerekirse rollback |

## V1-5) Dağıtım sonrası (bayraklar 0)

```bash
DATABASE_URL="$PROD_DATABASE_URL" npx prisma migrate status
# → Database schema is up to date!

psql "$PROD_DATABASE_URL" -f scripts/sql/prod-postdeploy-checks.sql
```

| Sorgu | Görmen gereken | Görmezsen |
|---|---|---|
| 1 — sayaçlar | `write_on`/`k1_on`/… = 0 | Acil bayrak SQL (Rollback bölümü) |
| 2 — açık tenant listesi | **0 satır** | Aynı SQL; Meta yazma yok diye varsayma — doğrula |
| Audit `meta_write` | Boş veya yalnızca eski dry-run | Yeni canlı yazım satırı → kapıları kontrol et, dur |

## V1-6) Panelde dry-run paketi (elle)

Yazma bayrakları **kapalı** kalır. Amaç: UI + paket/onay yolu; Meta’ya canlı POST yok.

1. Staff panel → **`/meta-yayin`** (Meta yayın).
2. Üstten bir **marka** seç (Meta hesabı eşli).
3. Soldan bir **reklam** seç (kampanya kimliği `unknown` olmamalı).
4. Sekme **Durum / bütçe** → örn. reklam durumunu `PAUSED` / `ACTIVE` değiştir (veya günlük bütçe — CBO/lifetime/currency kilitliyse durum kullan).
5. **Taslak kaydet** → **Onaya gönder**.
6. **Onay bekleyenler** → **Onayla** → önizleme modalı açılır.
7. Modalda kampanya/set/reklam + eski→yeni alanları gör → **Onayla ve uygula**.

| Görmen gereken | Görmezsen |
|---|---|
| Paket `pending` → onay sonrası `simulated` veya `skipped` (kapılar kapalı) | `applied` + canlı Meta değişimi → **DUR**, bayrak/`META_ADS_WRITE` kontrol |
| Önizlemesiz onay reddi / fingerprint zorunlu | Önizlemesiz geçiyorsa regressyon |
| `prod-postdeploy` audit’te yeni canlı `meta_write` yok (dry-run kayıtları olabilir) | Canlı Graph yazımı → rollback + kapı kapat |

## Rollback V1

```bash
# Dokploy: önceki çalışan image/commit’e Redeploy (örn. 055b83d)
# Yerel prova: V1 şemalı DB + eski commit migrate deploy → OK (additive).
# Failed migration varken eski commit de P3009 ile açılmaz — önce resolve/restore.

# Acil: tüm yazma bayraklarını kapat
# Nerede: DB konteyneri psql VEYA app konteyneri prisma db execute
psql "$PROD_DATABASE_URL" -c '
UPDATE "Tenant" SET
  "metaAdsWriteEnabled"=false,
  "metaAdsWriteTierK1"=false,
  "metaAdsWriteTierK2"=false,
  "metaAdsWriteTierK3"=false,
  "metaAdsWriteTierK4"=false;'
```

Şema additive — geri migration yok. Dump/Dokploy restore **yalnızca** veri/şema felaketinde (önce onay).

Acil boot (migrate’i atla): Dokploy start → `npm run start:app` — failed-mig kurtarma veya bilinen uyumlu şema; kalıcı bırakma.

---

# Sürüm 2 — yapı sync, önizleme, kampanya bağlamı, para birimi

V1 canlı ve V1-5/V1-6 OK olduktan sonra. **V1 etiketini retag etme.**

## V2-1) Dağıtılacak commit etiketi

Etiket zaten var: `ads-publish-prod-dryrun-2` → `ad13b08`.

```bash
git fetch --tags
git rev-parse ads-publish-prod-dryrun-2
# beklenen: ad13b08935e173e1d1657e48f4fed4664f3a8cf0

# Yoksa (bir kez):
# git tag ads-publish-prod-dryrun-2 ad13b08
# git push origin ads-publish-prod-dryrun-2
```

| Görmen gereken | Görmezsen |
|---|---|
| `ad13b08…` | Etiketi oluştur/push; deploy etme |

Yedek:

```bash
DUMP_FILE="$DUMP_DIR/593-pre-v2-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump "$PROD_DATABASE_URL" --format=custom --file="$DUMP_FILE"
ls -lh "$DUMP_FILE"
```

## V2-2) Yeni migration’lar

| Klasör | İçerik |
|---|---|
| `20261114220000_meta_campaign_adset_structure` | `MetaCampaign`, `MetaAdSet` |
| `20261114223000_ad_change_approval_preview` | `AdChangeApproval.previewJson` |
| `20261114230000_tenant_meta_currency` | `Tenant.metaCurrency` |

```bash
git checkout ads-publish-prod-dryrun-2
DATABASE_URL="$PROD_DATABASE_URL" npx prisma migrate status
# V1 applied; pending: 220000, 223000, 230000 (veya hepsi applied)
```

## V2-3) Dağıtım + bir markada yapı sync

1. Dokploy → **`ads-publish-prod-dryrun-2` / `ad13b08`** → Redeploy.
2. `META_ADS_WRITE` hâlâ kapalı; bayraklar 0.

```bash
DATABASE_URL="$PROD_DATABASE_URL" npx prisma migrate status
# → up to date (üç V2 migration dahil)
```

Tek marka Meta sync (yazma yok — Graph okuma + DB upsert):

```bash
# UI: Markalar → ilgili marka → Sync (yalnızca Meta)
# veya:
curl -sS -X POST "$ADMIN_HOST/api/panel/sync" \
  -H "Cookie: $SESSION_COOKIE" \
  -H "Content-Type: application/json" \
  -d '{"tenantSlug":"<MARKA_SLUG>","providers":["meta"]}'

# Poll:
curl -sS "$ADMIN_HOST/api/panel/sync/status" -H "Cookie: $SESSION_COOKIE"
```

| Görmen gereken | Görmezsen |
|---|---|
| Sync `ok` / tamamlandı | 401/504 → cookie / Traefik timeout; `after()` arka plan — status poll |
| `MetaCampaign` / `MetaAdSet` satırları artıyor | Token/izin; sync log |
| `Tenant.metaCurrency` doluyor | Hesap currency alanı okunamadı — log |

## V2-4) Eksiksizlik + para birimi

```bash
psql "$PROD_DATABASE_URL" -f scripts/sql/meta-structure-completeness.sql
psql "$PROD_DATABASE_URL" -f scripts/sql/prod-postdeploy-checks.sql
# token’lı shell varsa:
# npx tsx scripts/report-meta-structure-completeness.ts
```

| Kontrol | Görmen gereken | Görmezsen |
|---|---|---|
| `ads_missing_campaign_row` / `ads_missing_adset_row` | Sync sonrası belirgin düşüş / 0’a yakın | Sync eksik veya age window — `META_STRUCTURE_INACTIVE_MAX_AGE_DAYS` |
| `no_campaign_id` | Düşük | Yapı sync alanları |
| Postdeploy sorgu 3 / completeness §5 currency | 0 satır veya **bilinen** istisna listesi | Panel `currency` ≠ Meta — bütçe kilidi; düzelt veya not et |
| Bayrak sayaçları | Hâlâ 0 | Acil bayrak SQL |

## V2-5) Eski ekranlarda beklenen sayılar

Durdurulmuşlar sync’e girebilir; şu ekranlar **yalnızca `effectiveStatus = ACTIVE`** okur → **V1 öncesi sayılarla aynı kalmalı** (şişme yok):

| Ekran | Beklenen | Sapma |
|---|---|---|
| Kampanyalar (`active-campaigns`) | ACTIVE seti ≈ eski | Şişme → filtre regressyon → **Rollback V2** |
| Bütçe (`brand-budget`) | Aynı | Aynı |
| Marka Meta (`/meta`) | Aynı | Aynı |
| Kurulum UTM | Aynı | Aynı |

Meta yayın (`/meta-yayin`) bilinçli olarak PAUSED gösterir — orada artış normal.

Kampanya PAUSED iken reklam `status=ACTIVE` ama `effectiveStatus=CAMPAIGN_PAUSED` → eski ekranda **görünmez**.

## V2-6) Senkronizasyon süresi × zamanlayıcı pencereleri

İstanbul saatine göre (`daily-sync-scheduler.ts`):

| Job | Pencere | Not |
|---|---|---|
| Günlük sync | 09:00 ve 18:00, **ilk 15 dk** (`SLOT_WINDOW_MINUTES=15`) | Slot kaçarsa bir sonraki 09/18 |
| Saatlik harcama | Her saatin **5–14. dakikası** | Min aralık ~40 dk |
| Ads-publish job kuyruk | Her dakika tick | Bayrak kapalıyken simulate/skip |
| Yedek | 03:00’dan sonra günde bir | Board snapshot |

**Elle tetiklenen** marka sync pencereye bağlı değil; uzun sürebilir.

| Görmen gereken | Görmezsen |
|---|---|
| Tek marka elle sync makul sürede biter (dakikalar; hesap boyutuna bağlı) | Saatler → gece/düşük trafik; günlük slot’u tıkama |
| Günlük slot’ta `inFlight` kilidi üst üste binmeyi engeller | Log’da sürekli fail → token/rate limit |

V2 sonrası tam portföy sync’i mümkünse **09:00/18:00 slot’u dışında** elle veya kademeli yap.

## Rollback V2

```bash
# Dokploy → ads-publish-prod-dryrun-1 (a85dde8) Redeploy
# V2 tabloları DB’de kalır; V1 kod yok sayar

psql "$PROD_DATABASE_URL" -c '
UPDATE "Tenant" SET
  "metaAdsWriteEnabled"=false,
  "metaAdsWriteTierK1"=false,
  "metaAdsWriteTierK2"=false,
  "metaAdsWriteTierK3"=false,
  "metaAdsWriteTierK4"=false;'
```

---

# Sıra özeti

1. **Yedek:** Dokploy DB Backup (+ doğrula) ve/veya `pg_dump`; panel `/yedekler` tek başına yetmez.
2. **V1:** salt okunur karar → `META_ADS_WRITE` kapalı → Dokploy `a85dde8` → postdeploy bayrak 0 → `/meta-yayin` dry-run (Muhammet).
3. **V2:** yedek → `ads-publish-prod-dryrun-2` → Dokploy `ad13b08` → bir marka Meta sync → completeness + currency → eski ekran sayıları.
4. Failed migrate → panel kapalı; `migrate resolve` (app konteyneri) veya DB restore. Yazma bayrakları kapalı; K1 canlı `(d)` ayrı onay.
