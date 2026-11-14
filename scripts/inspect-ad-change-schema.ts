import "dotenv/config";
import { PrismaClient } from "@prisma/client";

async function main() {
  const p = new PrismaClient();
  const tables = await p.$queryRawUnsafe<Array<{ tablename: string }>>(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename ILIKE '%AdChange%' OR tablename ILIKE '%PanelNotice%' OR tablename ILIKE '%Creative%' OR tablename ILIKE '%AdAnalysis%') ORDER BY 1`,
  );
  const cols = await p.$queryRawUnsafe<Array<{ column_name: string }>>(
    `SELECT column_name FROM information_schema.columns WHERE table_name='Tenant' AND column_name LIKE 'metaAds%' ORDER BY 1`,
  );
  const enums = await p.$queryRawUnsafe<
    Array<{ typname: string; enumlabel: string }>
  >(
    `SELECT t.typname, e.enumlabel FROM pg_type t JOIN pg_enum e ON t.oid=e.enumtypid WHERE t.typname LIKE 'AdChange%' ORDER BY 1, e.enumsortorder`,
  );
  console.log(JSON.stringify({ tables, tenantFlags: cols, enums }, null, 2));
  await p.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
