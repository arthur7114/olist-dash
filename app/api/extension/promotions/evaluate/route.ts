import { evaluatePromotionsRequestSchema } from "@oem/contracts"
import { requireExtensionAuthorization, privateJson } from "@/lib/extension-auth"
import { dbMoneyToCents, getMlItem, listMlPromotions } from "@/lib/db/pricing"
import { evaluateStoredPromotion, simulateItemPricing } from "@/lib/pricing/service"

export const runtime = "nodejs"
export const maxDuration = 120

export async function POST(request: Request) {
  const denied = requireExtensionAuthorization(request)
  if (denied) return denied
  const parsed = evaluatePromotionsRequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return privateJson({ ok: false, error: "Lote inválido.", issues: parsed.error.issues }, { status: 422 })
  const stored = await listMlPromotions(5_000)
  const results = []
  for (const entry of parsed.data.entries) {
    const promotion = stored.find((row) =>
      row.itemId === entry.itemId && row.promotionId === entry.promotionId && row.type === entry.type &&
      (entry.offerId == null || row.offerId === entry.offerId),
    )
    if (!promotion) {
      results.push({ entry, ok: false, error: "Promoção não encontrada no cache." })
      continue
    }
    try {
      const evaluation = await evaluateStoredPromotion(promotion.key, parsed.data.includeTargetPrices)
      const item = await getMlItem(entry.itemId)
      const currentPriceCents = dbMoneyToCents(item?.currentPrice)
      const currentEvaluation = currentPriceCents && currentPriceCents > 0
        ? await simulateItemPricing(entry.itemId, currentPriceCents, 0, false)
        : null
      results.push({ entry, ok: true, evaluation, currentEvaluation })
    } catch (error) {
      results.push({ entry, ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return privateJson({ ok: true, results })
}
