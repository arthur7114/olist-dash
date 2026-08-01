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
  const baselineByItem = new Map<string, Promise<Awaited<ReturnType<typeof simulateItemPricing>> | null>>()
  const results = await mapWithConcurrency(parsed.data.entries, 4, async (entry) => {
    const promotion = stored.find((row) =>
      row.itemId === entry.itemId && row.promotionId === entry.promotionId && row.type === entry.type &&
      (entry.offerId == null || row.offerId === entry.offerId),
    )
    if (!promotion) {
      return { entry, ok: false as const, error: "Promoção não encontrada no cache." }
    }
    try {
      const evaluation = await evaluateStoredPromotion(promotion.key, parsed.data.includeTargetPrices)
      let baseline = baselineByItem.get(entry.itemId)
      if (!baseline) {
        baseline = getMlItem(entry.itemId).then((item) => {
          const currentPriceCents = dbMoneyToCents(item?.currentPrice)
          return currentPriceCents && currentPriceCents > 0
            ? simulateItemPricing(entry.itemId, currentPriceCents, 0, false)
            : null
        })
        baselineByItem.set(entry.itemId, baseline)
      }
      return { entry, ok: true as const, evaluation, currentEvaluation: await baseline }
    } catch (error) {
      return { entry, ok: false as const, error: error instanceof Error ? error.message : String(error) }
    }
  })
  return privateJson({ ok: true, results })
}

async function mapWithConcurrency<T, R>(values: T[], concurrency: number, task: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    for (;;) {
      const index = next++
      if (index >= values.length) return
      results[index] = await task(values[index])
    }
  }))
  return results
}
