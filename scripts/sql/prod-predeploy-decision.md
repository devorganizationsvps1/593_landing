# Prod salt okunur kontrol — nasıl okunur / ne yapılır

Prod’da **hiçbir yazma komutu çalıştırma** (bu dosya yalnızca rehber).
Dağıtılacak commit: `ads-publish-prod-dryrun-1` (= `1973a7d`).

Ship edilen migration’lar (yalnızca bunlar):

1. `20261114120000_ad_change_packages`
2. `20261114191000_ad_change_step_idempotency`
3. `20261114193000_ad_change_write_gates`
4. `20261114210000_panel_notice`

`20261114180000_creative_analysis_ops` depoda yok — uygulamayın.

## A) `prisma migrate status`

```bash
# Prod URL’yi yalnızca okumak için; migrate deploy / resolve ÇALIŞTIRMA
cd /path/to/checkout-at-ads-publish-prod-dryrun-1
DATABASE_URL="$PROD_DATABASE_URL" npx prisma migrate status
```

| Sonuç | Anlam | Ne yap |
|---|---|---|
| `Database schema is up to date!` | Dört migration zaten uygulanmış | App deploy yeterli; SQL ile bayrak/enum doğrula |
| `Following migration(s) have not yet been applied:` + listede `12000` / `91000` / `93000` / `21000` | Eksik additive migration’lar | Yedek → deploy sırasında `migrate deploy` (app `start` script’i bunu çalıştırır) |
| Listede `20261114180000_creative_analysis_ops` görünüyor | Yanlışlıkla depoda kalmış | **Deploy etme**; klasörü çıkar |
| `The following migration(s) are applied to the database but missing from the local migrations directory` | Prod’da fazladan kayıt | SQL B ile objeleri doğrula; local eksikse sync et — kör `resolve` yapma |
| `P3005` / failed migration / drift | Şema elle veya kısmi | SQL B → resolve veya deploy matrisi |

`migrate status` çıktısındaki “pending” satırları `_prisma_migrations` ile local `prisma/migrations` farkıdır. Tablo/enum **zaten varsa** ama satır yoksa → `resolve --applied`; yoksa → düz `deploy`.

## B) Tablo / enum SQL → resolve vs deploy

```bash
psql "$PROD_DATABASE_URL" -f scripts/sql/prod-predeploy-readonly.sql
```

| Gözlem | Karar |
|---|---|
| Hiç `AdChange*` / `PanelNotice` yok | Düz deploy: `migrate deploy` (12000→21000) |
| `AdChangePackage` (+Job/Step) var, status pending `12000` | `prisma migrate resolve --applied 20261114120000_ad_change_packages` |
| AdChange* var, `idempotencyKey` yok, pending `91000` | Düz deploy (91000) |
| `idempotencyKey` var, status pending `91000` | `resolve --applied 20261114191000_ad_change_step_idempotency` |
| Enum’da `simulated`/`partial` yok, pending `93000` | Düz deploy (93000) |
| Enum’da `simulated` var, pending `93000` | `resolve --applied 20261114193000_ad_change_write_gates` |
| `Tenant.metaAdsWriteEnabled` / K1–K4 yok | write_gates (`93000`) deploy |
| `PanelNotice` yok, pending `21000` | Düz deploy (21000) |
| `PanelNotice` var, pending `21000` | `resolve --applied 20261114210000_panel_notice` |
| Creative*/AdAnalysis* **var** | Bu release yönetmez; dokunma / creative_analysis_ops uygulama |
| Hepsi var + status up to date | Yalnızca app deploy; bayraklar kapalı kalsın |

Resolve **yalnızca** “obje prod’da var, `_prisma_migrations` satırı yok” durumunda. Obje yokken resolve = yalan kayıt → sonraki deploy kırılır.

## C) Job kuyruğu

```sql
SELECT status, COUNT(*) FROM "AdChangeJob"
WHERE status IN ('queued','running') GROUP BY 1;
-- Tablo yoksa: relation does not exist → A/B’de 12000 henüz yok; kuyruk N/A
```

| n | Ne yap |
|---|---|
| 0 / tablo yok | Temiz |
| >0 | Not et; deploy sonrası scheduler dry-run finalize edebilir. `META_ADS_WRITE` kapalı kalsın |

## D) Dağıtım sonrası

`scripts/sql/prod-postdeploy-checks.sql` — tüm tenant’ta write+K1–K4 = 0; son 10 `meta_write` AuditLog.

## E) Geri dönüş

Önceki sürüm (main): `055b83d565f2513d08e497e93d32f5e4c294f810`

```bash
git checkout 055b83d
# platformunuza göre yeniden dağıtın; örnek:
# git push -f <deploy-remote> 055b83d:main   # yalnızca bilinçli rollback
# veya image/tag’i 055b83d’ye çekip redeploy
```

Not: rollback app kodunu geri alır; additive migration tabloları DB’de kalır (zararsız). `META_ADS_WRITE` kapalı kalsın.
