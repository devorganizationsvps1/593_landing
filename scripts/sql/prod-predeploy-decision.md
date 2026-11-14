# Prod salt okunur kontrol — nasıl okunur / ne yapılır

Prod’da **hiçbir yazma komutu çalıştırma** (bu dosya yalnızca rehber).

## A) `prisma migrate status`

```bash
# Prod URL’yi yalnızca okumak için; migrate deploy ÇALIŞTIRMA
DATABASE_URL="$PROD_DATABASE_URL" npx prisma migrate status
```

| Sonuç | Anlam | Ne yap |
|---|---|---|
| `Database schema is up to date!` | Tüm git migration’ları uygulanmış | App deploy yeterli; yine de SQL ile enum/bayrak doğrula |
| `Following migration(s) have not yet been applied:` + listede `…91000…` / `…93000…` / `…21000…` | Güvenlik turu migration’ları eksik | Yedek → `migrate deploy` (yalnızca bu dalın tracked migration’ları) |
| Listede `20261114180000_creative_analysis_ops` görünüyor | Yanlışlıkla depoda kalmış | **Deploy etme**; klasörü çıkar, commit’i düzelt |
| `P3005` / drift / failed migration | Şema elle veya kısmi | Aşağıdaki SQL ile hangi objelerin var olduğuna bak → karar matrisi B |

## B) Tablo / enum SQL sonucu → migration resolve

`scripts/sql/prod-predeploy-readonly.sql` çıktısına göre:

| Gözlem | Karar |
|---|---|
| `AdChangePackage` yok | Sıfırdan: `migrate deploy` (12000’den itibaren) |
| AdChange* var, `idempotencyKey` yok | `20261114191000_ad_change_step_idempotency` henüz uygulanmamış → deploy |
| `idempotencyKey` var ama migrate status “pending 91000” | Tablo elle/önceki deneme: `prisma migrate resolve --applied 20261114191000_ad_change_step_idempotency` sonra status |
| Enum’da `simulated`/`partial` yok | `20261114193000_ad_change_write_gates` deploy |
| Enum’da `simulated` var ama status “pending 93000” | `migrate resolve --applied 20261114193000_ad_change_write_gates` |
| `PanelNotice` yok | `20261114210000_panel_notice` deploy |
| `PanelNotice` var, status pending 21000 | `migrate resolve --applied 20261114210000_panel_notice` |
| `Tenant.metaAdsWrite*` yok | write_gates migration deploy |
| Creative*/AdAnalysis* **var** | Bu release onları **yönetmez**; dokunma. creative_analysis_ops’u uygulamaya |
| `queued`/`running` job > 0 | Deploy öncesi not et; deploy sonrası `processQueuedAdChangeJobs` dry-run ile bitebilir. Canlı yazma kapalı kalmalı |

## C) Job kuyruğu

```sql
SELECT status, COUNT(*) FROM "AdChangeJob"
WHERE status IN ('queued','running') GROUP BY 1;
```

| n | Ne yap |
|---|---|
| 0 | Temiz |
| >0 | Deploy sonrası scheduler dry-run finalize eder; `META_ADS_WRITE` kapalı kalsın |
