import { pricingOverrideSchema, pricingSettingsSchema } from "@oem/contracts"
import { z } from "zod"
import { requireExtensionAuthorization, privateJson } from "@/lib/extension-auth"
import { getPricingOverride, getPricingSettings, savePricingOverride, savePricingSettings } from "@/lib/db/pricing"

const updateSchema = z.union([
  z.object({ settings: pricingSettingsSchema }),
  z.object({ override: pricingOverrideSchema }),
])

export async function GET(request: Request) {
  const denied = requireExtensionAuthorization(request)
  if (denied) return denied
  const itemId = new URL(request.url).searchParams.get("itemId")
  const [settings, override] = await Promise.all([
    getPricingSettings(),
    itemId ? getPricingOverride(itemId) : Promise.resolve(null),
  ])
  return privateJson({ ok: true, settings, override })
}

export async function PUT(request: Request) {
  const denied = requireExtensionAuthorization(request)
  if (denied) return denied
  const parsed = updateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return privateJson({ ok: false, error: "Configuração inválida.", issues: parsed.error.issues }, { status: 422 })
  if ("settings" in parsed.data) return privateJson({ ok: true, settings: await savePricingSettings(parsed.data.settings) })
  return privateJson({ ok: true, override: await savePricingOverride(parsed.data.override) })
}
