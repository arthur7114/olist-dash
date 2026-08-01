import { requireExtensionAuthorization, privateJson } from "@/lib/extension-auth"
import { dbMoneyToCents, listMlItems, listMlPromotions } from "@/lib/db/pricing"

export async function GET(request: Request) {
  const denied = requireExtensionAuthorization(request)
  if (denied) return denied
  const search = new URL(request.url).searchParams.get("q") ?? ""
  const [items, promotions] = await Promise.all([listMlItems(search), listMlPromotions()])
  return privateJson({
    ok: true,
    items: items.map((item) => ({
      itemId: item.itemId,
      sellerSku: item.sellerSku,
      title: item.title,
      currentPriceCents: dbMoneyToCents(item.currentPrice),
      status: item.status,
      syncedAt: item.syncedAt.toISOString(),
    })),
    promotions: promotions.map((promotion) => ({
      key: promotion.key,
      itemId: promotion.itemId,
      promotionId: promotion.promotionId,
      offerId: promotion.offerId,
      type: promotion.type,
      status: promotion.status,
      name: promotion.name,
      originalPriceCents: dbMoneyToCents(promotion.originalPrice),
      candidatePriceCents: dbMoneyToCents(promotion.candidatePrice ?? promotion.suggestedPrice),
      feeReductionCents: dbMoneyToCents(promotion.feeReduction) ?? 0,
      syncedAt: promotion.syncedAt.toISOString(),
    })),
  })
}
