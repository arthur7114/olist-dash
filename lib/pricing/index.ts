import type { PricingEvaluation } from "@oem/contracts"

export type PricingSource = PricingEvaluation["sources"][number]

export interface ResolvedPricingInput {
  itemId: string
  sellerSku: string | null
  title: string
  currencyId: string
  currentPriceCents: number | null
  candidatePriceCents: number
  saleFeeCents: number | null
  feeReductionCents: number
  shippingCostCents: number | null
  productCostCents: number | null
  taxRateBps: number | null
  adsRateBps: number
  fixedCostCents: number
  minimumMarginBps: number | null
  targetMarginBps: number | null
  requiredUpdatedAt: string | null
  sources: PricingSource[]
}

const MAX_ESSENTIAL_AGE_MS = 24 * 60 * 60 * 1000

export function evaluatePricing(
  input: ResolvedPricingInput,
  now = new Date(),
): PricingEvaluation {
  const blockedReasons: string[] = []
  if (input.productCostCents == null) blockedReasons.push("Custo do produto não disponível.")
  if (input.shippingCostCents == null) blockedReasons.push("Frete não disponível.")
  if (input.saleFeeCents == null) blockedReasons.push("Tarifa de venda não disponível.")
  if (input.taxRateBps == null) blockedReasons.push("Imposto padrão não configurado.")
  if (input.minimumMarginBps == null) blockedReasons.push("Margem mínima não configurada.")
  if (input.targetMarginBps == null) blockedReasons.push("Margem-alvo não configurada.")

  const updatedAtMs = input.requiredUpdatedAt ? Date.parse(input.requiredUpdatedAt) : Number.NaN
  const stale = Number.isFinite(updatedAtMs) && now.getTime() - updatedAtMs > MAX_ESSENTIAL_AGE_MS
  if (stale) blockedReasons.push("Dados essenciais desatualizados há mais de 24 horas.")

  const taxCents = rateAmount(input.candidatePriceCents, input.taxRateBps ?? 0)
  const adsCents = rateAmount(input.candidatePriceCents, input.adsRateBps)
  const breakdown = {
    revenueCents: input.candidatePriceCents,
    saleFeeCents: input.saleFeeCents ?? 0,
    feeReductionCents: Math.min(Math.max(0, input.feeReductionCents), Math.max(0, input.saleFeeCents ?? 0)),
    shippingCents: input.shippingCostCents ?? 0,
    productCostCents: input.productCostCents ?? 0,
    taxCents,
    adsCents,
    fixedCostCents: input.fixedCostCents,
  }
  const marginCents =
    breakdown.revenueCents -
    breakdown.saleFeeCents +
    breakdown.feeReductionCents -
    breakdown.shippingCents -
    breakdown.productCostCents -
    breakdown.taxCents -
    breakdown.adsCents -
    breakdown.fixedCostCents
  const marginBps = input.candidatePriceCents > 0
    ? Math.round((marginCents * 10_000) / input.candidatePriceCents)
    : null

  let recommendation: PricingEvaluation["recommendation"] = "incomplete"
  if (!blockedReasons.length && marginBps != null) {
    if (marginCents <= 0 || marginBps < (input.minimumMarginBps ?? 0)) recommendation = "avoid"
    else if (marginBps < (input.targetMarginBps ?? 0)) recommendation = "review"
    else recommendation = "recommended"
  }

  return {
    item: {
      itemId: input.itemId,
      sellerSku: input.sellerSku,
      title: input.title,
      currentPriceCents: input.currentPriceCents,
      candidatePriceCents: input.candidatePriceCents,
      currencyId: input.currencyId,
    },
    breakdown,
    marginCents,
    marginBps,
    minimumPriceCents: null,
    targetPriceCents: null,
    recommendation,
    blockedReasons,
    sources: input.sources,
    stale,
    calculatedAt: now.toISOString(),
  }
}

export function rateAmount(amountCents: number, rateBps: number): number {
  return Math.round((amountCents * rateBps) / 10_000)
}

export type PricingQuote = Pick<ResolvedPricingInput, "saleFeeCents" | "shippingCostCents"> & {
  feeReductionCents?: number
}

export async function findPriceForMargin(
  base: ResolvedPricingInput,
  targetMarginBps: number,
  quote: (priceCents: number) => Promise<PricingQuote>,
  now = new Date(),
): Promise<number | null> {
  let low = 1
  let high = Math.max(100, base.candidatePriceCents, base.currentPriceCents ?? 0)

  for (let expansion = 0; expansion < 6; expansion += 1) {
    const evaluation = await evaluateAtPrice(base, high, quote, now)
    if (meetsTarget(evaluation, targetMarginBps)) break
    high *= 2
    if (expansion === 5) return null
  }

  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const evaluation = await evaluateAtPrice(base, middle, quote, now)
    if (meetsTarget(evaluation, targetMarginBps)) high = middle
    else low = middle + 1
  }
  return low
}

function meetsTarget(evaluation: PricingEvaluation, targetMarginBps: number): boolean {
  return (
    evaluation.recommendation !== "incomplete" &&
    evaluation.item.candidatePriceCents > 0 &&
    evaluation.marginCents * 10_000 >= evaluation.item.candidatePriceCents * targetMarginBps
  )
}

async function evaluateAtPrice(
  base: ResolvedPricingInput,
  priceCents: number,
  quote: (priceCents: number) => Promise<PricingQuote>,
  now: Date,
): Promise<PricingEvaluation> {
  const variable = await quote(priceCents)
  return evaluatePricing(
    {
      ...base,
      candidatePriceCents: priceCents,
      saleFeeCents: variable.saleFeeCents,
      shippingCostCents: variable.shippingCostCents,
      feeReductionCents: variable.feeReductionCents ?? base.feeReductionCents,
    },
    now,
  )
}
