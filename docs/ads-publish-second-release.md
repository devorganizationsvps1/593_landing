# Ads publish — ikinci sürüm dağıtım notu

Dağıtım etiketi `ads-publish-prod-dryrun-1` (`a85dde8`) **değiştirilmedi**.
Bu not, o etiketin **üzerindeki** commit’ler içindir (`ee4b561` … güncel `wip/ads-publish`).

## Yeni migration’lar (eklemeli)

| Migration | İçerik |
|---|---|
| `20261114220000_meta_campaign_adset_structure` | `MetaCampaign`, `MetaAdSet` + `MetaAd` indexleri |
| `20261114223000_ad_change_approval_preview` | `AdChangeApproval.previewJson` |
| `20261114230000_tenant_meta_currency` | `Tenant.metaCurrency` (Meta hesap para birimi) |

Uygulamadan önce SQL’i gözden geçirin; `prisma migrate deploy` (veya app `start` script’i).

## Eski ekranlarda beklenen davranış

Durdurulmuş reklamlar artık sync’e girebilir; şu tüketiciler **yalnızca `effectiveStatus = ACTIVE`** okur — liste/sayılar eski sync ile aynı kalmalı:

- Kampanyalar (`active-campaigns`)
- Bütçe (`brand-budget`)
- Marka Meta ekranı (`data` → `/meta`)
- Kurulum UTM (`setup-checks`)

Kampanya PAUSED iken reklamın `status=ACTIVE` ama `effectiveStatus=CAMPAIGN_PAUSED` olması durumunda eski ekranda **görünmez** (effectiveStatus filtresi).

Meta yayın paneli bilinçli olarak PAUSED gösterir.

## Hacim

`META_STRUCTURE_INACTIVE_MAX_AGE_DAYS` (varsayılan 180). ACTIVE kesilmez.

## Dağıtım sonrası — eksiksizlik

```bash
npx tsx scripts/report-meta-structure-completeness.ts
# veya
psql "$DATABASE_URL" -f scripts/sql/meta-structure-completeness.sql
```

Kontrol: `no_campaign_id`, `ads_missing_campaign_row`, `ads_missing_adset_row`, bütçe dağılımı (cbo/abo, daily/lifetime), **para birimi uyuşmayan markalar** (`currency` ≠ `metaCurrency`).

Ayrıca: `scripts/sql/prod-postdeploy-checks.sql` sorgu 3.

## Onay

Önizlemesiz / canlı değer okunamadan / fingerprint uyuşmazsa onay reddedilir.
Para birimi `Tenant.currency` (hesap senkronundan).

## (d) ön koşulu

Yerelde Meta token yoktu. Prod’da tek marka yapı sync + eksiksizlik raporu olmadan kampanya K1 yazımına başlanmamalı.
