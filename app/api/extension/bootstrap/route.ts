import { requireExtensionAuthorization, privateJson } from "@/lib/extension-auth"
import { hasDatabase } from "@/lib/db/client"
import { getCommercialSyncState, getPricingCoverage, getPricingSettings, listMlItems, listMlPromotions } from "@/lib/db/pricing"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const denied = requireExtensionAuthorization(request)
  if (denied) return denied
  if (!hasDatabase()) return privateJson({ ok: false, error: "DATABASE_URL não configurado." }, { status: 503 })
  const [settings, sync, items, promotions, coverage] = await Promise.all([
    getPricingSettings(),
    getCommercialSyncState(),
    listMlItems("", 1_000),
    listMlPromotions(2_000),
    getPricingCoverage(),
  ])
  return privateJson({
    ok: true,
    settingsComplete: settings.taxRateBps != null && settings.minimumMarginBps != null && settings.targetMarginBps != null,
    settings,
    catalog: { items: items.length, promotions: promotions.length },
    coverage,
    lastSync: sync?.lastSuccessAt?.toISOString() ?? null,
    syncStatus: sync?.status ?? "idle",
  })
}
