import type { PricingEvaluation } from "@oem/contracts"
import { getMlAccessToken } from "@/lib/ml-api"
import {
  fetchMlCommercialJson,
  quoteSaleFeeCents,
  quoteShippingCents,
} from "@/lib/ml-commercial"
import {
  dbMoneyToCents,
  getMlItem,
  getMlPromotion,
  getPricingOverride,
  getPricingSettings,
  resolveProductCostCents,
} from "@/lib/db/pricing"
import { evaluatePricing, findPriceForMargin, type PricingQuote, type ResolvedPricingInput } from "."

const priceCache = new Map<string, { expiresAt: number; value: number | null }>()
const PRICE_CACHE_MS = 30 * 60 * 1000
const PRICE_CACHE_MAX_ENTRIES = 1_000
let sellerCache: { id: string; expiresAt: number } | null = null

export async function simulateItemPricing(
  itemId: string,
  candidatePriceCents: number,
  feeReductionCents = 0,
  includeTargetPrices = true,
): Promise<PricingEvaluation> {
  const [item, settings, override, accessToken] = await Promise.all([
    getMlItem(itemId),
    getPricingSettings(),
    getPricingOverride(itemId),
    getMlAccessToken(),
  ])
  if (!item) throw new PricingNotFoundError(`Anúncio ${itemId} não encontrado no catálogo.`)
  if (item.currencyId !== "BRL") throw new PricingValidationError("A v1 aceita apenas anúncios em BRL.")

  const [sellerId, productCostCents] = await Promise.all([
    getSellerId(accessToken),
    resolveProductCostCents(item, override),
  ])
  const quote = (priceCents: number) => quoteItemCosts({
    item,
    sellerId,
    accessToken,
    priceCents,
    shippingOverrideCents: override?.shippingCostCents,
    feeReductionCents,
  })
  const variable = await quote(candidatePriceCents)
  const updatedAt = item.syncedAt.toISOString()
  const resolved: ResolvedPricingInput = {
    itemId: item.itemId,
    sellerSku: item.sellerSku,
    title: item.title,
    currencyId: item.currencyId,
    currentPriceCents: dbMoneyToCents(item.currentPrice),
    candidatePriceCents,
    saleFeeCents: variable.saleFeeCents,
    feeReductionCents,
    shippingCostCents: variable.shippingCostCents,
    productCostCents,
    taxRateBps: override?.taxRateBps ?? settings.taxRateBps,
    adsRateBps: override?.adsRateBps ?? settings.adsRateBps,
    fixedCostCents: override?.fixedCostCents ?? settings.fixedCostCents,
    minimumMarginBps: override?.minimumMarginBps ?? settings.minimumMarginBps,
    targetMarginBps: override?.targetMarginBps ?? settings.targetMarginBps,
    requiredUpdatedAt: updatedAt,
    sources: [
      { field: "preço/tarifa/frete", source: "mercado_livre", updatedAt },
      { field: "custo do produto", source: override?.productCostCents != null ? "override" : "olist", updatedAt: null },
      { field: "parâmetros financeiros", source: override ? "override" : "settings", updatedAt: null },
    ],
  }
  const evaluation = evaluatePricing(resolved)
  if (evaluation.recommendation === "incomplete" || !includeTargetPrices) return evaluation

  const [minimumPriceCents, targetPriceCents] = await Promise.all([
    cachedTargetPrice(resolved, resolved.minimumMarginBps!, quote),
    cachedTargetPrice(resolved, resolved.targetMarginBps!, quote),
  ])
  return { ...evaluation, minimumPriceCents, targetPriceCents }
}

export async function evaluateStoredPromotion(key: string, includeTargetPrices = false): Promise<PricingEvaluation> {
  const promotion = await getMlPromotion(key)
  if (!promotion) throw new PricingNotFoundError(`Promoção ${key} não encontrada.`)
  const candidate = dbMoneyToCents(
    promotion.candidatePrice ?? promotion.suggestedPrice ?? promotion.originalPrice,
  )
  if (candidate == null || candidate <= 0) {
    throw new PricingValidationError("A promoção não informou um preço candidato válido.")
  }
  return simulateItemPricing(
    promotion.itemId,
    candidate,
    dbMoneyToCents(promotion.feeReduction) ?? 0,
    includeTargetPrices,
  )
}

async function quoteItemCosts(input: {
  item: NonNullable<Awaited<ReturnType<typeof getMlItem>>>
  sellerId: string
  accessToken: string
  priceCents: number
  shippingOverrideCents?: number | null
  feeReductionCents: number
}): Promise<PricingQuote> {
  const [saleFeeCents, shippingCostCents] = await Promise.all([
    quoteSaleFeeCents({
      priceCents: input.priceCents,
      categoryId: input.item.categoryId,
      listingTypeId: input.item.listingTypeId,
      logisticType: input.item.logisticType,
      shippingMode: input.item.shippingMode,
    }, input.accessToken),
    input.shippingOverrideCents != null
      ? Promise.resolve(input.shippingOverrideCents)
      : quoteShippingCents({
        sellerId: input.sellerId,
        itemId: input.item.itemId,
        priceCents: input.priceCents,
        listingTypeId: input.item.listingTypeId,
        logisticType: input.item.logisticType,
        shippingMode: input.item.shippingMode,
        freeShipping: input.item.freeShipping === 1,
      }, input.accessToken),
  ])
  return { saleFeeCents, shippingCostCents, feeReductionCents: input.feeReductionCents }
}

async function cachedTargetPrice(
  input: ResolvedPricingInput,
  targetMarginBps: number,
  quote: (priceCents: number) => Promise<PricingQuote>,
): Promise<number | null> {
  const key = [input.itemId, targetMarginBps, input.productCostCents, input.taxRateBps, input.adsRateBps,
    input.fixedCostCents, input.shippingCostCents, input.feeReductionCents, input.requiredUpdatedAt].join(":")
  const cached = priceCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  const value = await findPriceForMargin(input, targetMarginBps, quote)
  if (priceCache.size >= PRICE_CACHE_MAX_ENTRIES) priceCache.delete(priceCache.keys().next().value ?? "")
  priceCache.set(key, { value, expiresAt: Date.now() + PRICE_CACHE_MS })
  return value
}

async function getSellerId(accessToken: string): Promise<string> {
  if (sellerCache && sellerCache.expiresAt > Date.now()) return sellerCache.id
  const me = await fetchMlCommercialJson<{ id: string | number }>("/users/me", accessToken)
  const id = String(me.id)
  sellerCache = { id, expiresAt: Date.now() + 60 * 60 * 1000 }
  return id
}

export class PricingNotFoundError extends Error {}
export class PricingValidationError extends Error {}
