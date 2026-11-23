import { NextResponse } from "next/server";
import { IntegrationNotConfiguredError } from "@/lib/integrations/tokens";
import { requirePermissionApi } from "@/lib/panel/staff-auth";
import { listMetaPages, missingMetaPublishScopes } from "@/lib/social/meta";
import { PublishError } from "@/lib/social/types";

export const runtime = "nodejs";

/** GET — system user'ın yönetebildiği FB sayfaları + bağlı IG hesapları. */
export async function GET() {
  const { error } = await requirePermissionApi("brands.edit");
  if (error) return error;
  try {
    const [pages, missingScopes] = await Promise.all([listMetaPages(), missingMetaPublishScopes()]);
    return NextResponse.json({ pages, missingScopes });
  } catch (err) {
    const msg =
      err instanceof IntegrationNotConfiguredError || err instanceof PublishError
        ? err.message
        : "Meta sayfaları alınamadı";
    if (!(err instanceof IntegrationNotConfiguredError)) console.error("[meta pages]", err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
