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
  getPricingOverrideWithMetadata,
  getPricingSettingsWithMetadata,
  resolveProductCost,
} from "@/lib/db/pricing"
import { evaluatePricing, findPriceForMargin, type PricingQuote, type ResolvedPricingInput } from "."

const priceCache = new Map<string, { expiresAt: number; value: number | null }>()
const quoteCache = new Map<string, { expiresAt: number; value: Promise<PricingQuote> }>()
const PRICE_CACHE_MS = 30 * 60 * 1000
const PRICE_CACHE_MAX_ENTRIES = 1_000
const QUOTE_CACHE_MS = 5 * 60 * 1000
const QUOTE_CACHE_MAX_ENTRIES = 5_000
let sellerCache: { id: string; expiresAt: number } | null = null

export async function simulateItemPricing(
  itemId: string,
  candidatePriceCents: number,
  feeReductionCents = 0,
  includeTargetPrices = true,
  additionalEssentialUpdatedAt?: string,
): Promise<PricingEvaluation> {
  const [item, accessToken] = await Promise.all([
    getMlItem(itemId),
    getMlAccessToken(),
  ])
  if (!item) throw new PricingNotFoundError(`Anúncio ${itemId} não encontrado no catálogo.`)
  if (item.currencyId !== "BRL") throw new PricingValidationError("A v1 aceita apenas anúncios em BRL.")

  const [sellerId, settingsMetadata, overrideMetadata] = await Promise.all([
    getSellerId(accessToken),
    getPricingSettingsWithMetadata(),
    getPricingOverrideWithMetadata(itemId, item.sellerSku),
  ])
  const settings = settingsMetadata.value
  const override = overrideMetadata?.value ?? null
  const productCost = await resolveProductCost(item, override, overrideMetadata?.updatedAt)
  const quote = (priceCents: number) => cachedQuoteItemCosts({
    item,
    sellerId,
    accessToken,
    priceCents,
    shippingOverrideCents: override?.shippingCostCents,
    feeReductionCents,
  })
  const variable = await quote(candidatePriceCents)
  const updatedAt = item.syncedAt.toISOString()
  const overrideFields = [override?.productCostCents, override?.shippingCostCents, override?.taxRateBps,
    override?.adsRateBps, override?.fixedCostCents, override?.minimumMarginBps, override?.targetMarginBps]
  const usesOverride = overrideFields.some((value) => value != null)
  const usesSettings = [override?.taxRateBps, override?.adsRateBps, override?.fixedCostCents,
    override?.minimumMarginBps, override?.targetMarginBps].some((value) => value == null)
  const requiredUpdatedAt = oldestIsoDate([
    updatedAt,
    additionalEssentialUpdatedAt,
    productCost.source === "olist" ? productCost.updatedAt?.toISOString() : null,
  ])
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
    productCostCents: productCost.cents,
    taxRateBps: override?.taxRateBps ?? settings.taxRateBps,
    adsRateBps: override?.adsRateBps ?? settings.adsRateBps,
    fixedCostCents: override?.fixedCostCents ?? settings.fixedCostCents,
    minimumMarginBps: override?.minimumMarginBps ?? settings.minimumMarginBps,
    targetMarginBps: override?.targetMarginBps ?? settings.targetMarginBps,
    requiredUpdatedAt,
    sources: [
      { field: "preço/tarifa/frete", source: "mercado_livre", updatedAt },
      { field: "custo do produto", source: productCost.source, updatedAt: productCost.updatedAt?.toISOString() ?? null },
      ...(usesSettings ? [{ field: "parâmetros financeiros herdados", source: "settings" as const, updatedAt: settingsMetadata.updatedAt?.toISOString() ?? null }] : []),
      ...(usesOverride ? [{ field: "overrides", source: "override" as const, updatedAt: overrideMetadata?.updatedAt.toISOString() ?? null }] : []),
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
  const candidate = dbMoneyToCents(promotion.candidatePrice ?? promotion.suggestedPrice)
  const fallbackPrice = candidate ?? dbMoneyToCents(promotion.originalPrice)
  if (fallbackPrice == null || fallbackPrice <= 0) throw new PricingValidationError("A promoção não informou um preço válido.")
  const evaluation = await simulateItemPricing(
    promotion.itemId,
    fallbackPrice,
    dbMoneyToCents(promotion.feeReduction) ?? 0,
    includeTargetPrices && candidate != null,
    promotion.syncedAt.toISOString(),
  )
  if (candidate != null) return evaluation
  return {
    ...evaluation,
    recommendation: "incomplete",
    minimumPriceCents: null,
    targetPriceCents: null,
    blockedReasons: [...evaluation.blockedReasons, "Promoção não informou preço candidato ou sugerido."],
  }
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

function cachedQuoteItemCosts(input: Parameters<typeof quoteItemCosts>[0]): Promise<PricingQuote> {
  const key = [input.item.itemId, input.item.syncedAt.toISOString(), input.priceCents,
    input.shippingOverrideCents, input.feeReductionCents].join(":")
  const cached = quoteCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  const value = quoteItemCosts(input).catch((error) => {
    quoteCache.delete(key)
    throw error
  })
  if (quoteCache.size >= QUOTE_CACHE_MAX_ENTRIES) quoteCache.delete(quoteCache.keys().next().value ?? "")
  quoteCache.set(key, { value, expiresAt: Date.now() + QUOTE_CACHE_MS })
  return value
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

function oldestIsoDate(values: Array<string | undefined | null>): string | null {
  const timestamps = values.flatMap((value) => value ? [Date.parse(value)] : []).filter(Number.isFinite)
  return timestamps.length ? new Date(Math.min(...timestamps)).toISOString() : null
}

export class PricingNotFoundError extends Error {}
export class PricingValidationError extends Error {}
