import { simulatePricingRequestSchema } from "@oem/contracts"
import { requireExtensionAuthorization, privateJson } from "@/lib/extension-auth"
import { PricingNotFoundError, PricingValidationError, simulateItemPricing } from "@/lib/pricing/service"

export const runtime = "nodejs"
export const maxDuration = 60

export async function POST(request: Request) {
  const denied = requireExtensionAuthorization(request)
  if (denied) return denied
  const parsed = simulatePricingRequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return privateJson({ ok: false, error: "Simulação inválida.", issues: parsed.error.issues }, { status: 422 })
  try {
    const evaluation = await simulateItemPricing(
      parsed.data.itemId,
      parsed.data.candidatePriceCents,
      parsed.data.feeReductionCents ?? 0,
    )
    return privateJson({ ok: true, evaluation })
  } catch (error) {
    const status = error instanceof PricingNotFoundError ? 404 : error instanceof PricingValidationError ? 422 : 500
    return privateJson({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status })
  }
}
