import { describe, expect, it } from "vitest"
import { evaluatePricing, findPriceForMargin, rateAmount, type ResolvedPricingInput } from "@/lib/pricing"

function input(overrides: Partial<ResolvedPricingInput> = {}): ResolvedPricingInput {
  return {
    itemId: "MLB123",
    sellerSku: "SKU-1",
    title: "Produto",
    currencyId: "BRL",
    currentPriceCents: 12_000,
    candidatePriceCents: 10_000,
    saleFeeCents: 1_600,
    feeReductionCents: 200,
    shippingCostCents: 1_000,
    productCostCents: 4_000,
    taxRateBps: 900,
    adsRateBps: 500,
    fixedCostCents: 300,
    minimumMarginBps: 1_000,
    targetMarginBps: 1_800,
    requiredUpdatedAt: "2026-08-01T12:00:00.000Z",
    sources: [],
    ...overrides,
  }
}

describe("evaluatePricing", () => {
  it("calcula a composição em centavos e recomenda quando alcança a meta", () => {
    const result = evaluatePricing(input(), new Date("2026-08-01T13:00:00.000Z"))

    expect(result.breakdown).toEqual({
      revenueCents: 10_000,
      saleFeeCents: 1_600,
      feeReductionCents: 200,
      shippingCents: 1_000,
      productCostCents: 4_000,
      taxCents: 900,
      adsCents: 500,
      fixedCostCents: 300,
    })
    expect(result.marginCents).toBe(1_900)
    expect(result.marginBps).toBe(1_900)
    expect(result.recommendation).toBe("recommended")
  })

  it("classifica revisar e evitar nos limites configurados", () => {
    expect(
      evaluatePricing(input({ targetMarginBps: 2_000 }), new Date("2026-08-01T13:00:00.000Z"))
        .recommendation,
    ).toBe("review")
    expect(
      evaluatePricing(input({ shippingCostCents: 2_200 }), new Date("2026-08-01T13:00:00.000Z"))
        .recommendation,
    ).toBe("avoid")
  })

  it("respeita os limites exatos e não credita redução acima da tarifa", () => {
    const atTarget = evaluatePricing(input({ targetMarginBps: 1_900, feeReductionCents: 99_999 }), new Date("2026-08-01T13:00:00.000Z"))

    expect(atTarget.breakdown.feeReductionCents).toBe(1_600)
    expect(atTarget.marginCents).toBe(3_300)
    expect(atTarget.recommendation).toBe("recommended")
  })

  it("arredonda percentuais monetários de forma determinística", () => {
    expect(rateAmount(9_999, 725)).toBe(725)
    expect(rateAmount(1, 5_000)).toBe(1)
  })

  it("explica dados essenciais ausentes sem produzir recomendação", () => {
    const result = evaluatePricing(
      input({ productCostCents: null, shippingCostCents: null }),
      new Date("2026-08-01T13:00:00.000Z"),
    )

    expect(result.recommendation).toBe("incomplete")
    expect(result.blockedReasons).toEqual(["Custo do produto não disponível.", "Frete não disponível."])
  })

  it("bloqueia dados essenciais com mais de 24 horas", () => {
    const result = evaluatePricing(input(), new Date("2026-08-03T13:00:00.000Z"))

    expect(result.stale).toBe(true)
    expect(result.recommendation).toBe("incomplete")
    expect(result.blockedReasons).toContain("Dados essenciais desatualizados há mais de 24 horas.")
  })

  it("bloqueia metas efetivas inconsistentes após aplicar overrides", () => {
    const result = evaluatePricing(input({ minimumMarginBps: 2_000, targetMarginBps: 1_500 }), new Date("2026-08-01T13:00:00.000Z"))

    expect(result.recommendation).toBe("incomplete")
    expect(result.blockedReasons).toContain("Margem-alvo não pode ser inferior à margem mínima.")
  })
})

describe("findPriceForMargin", () => {
  it("encontra o menor preço em centavos que alcança a margem desejada", async () => {
    let calls = 0
    const result = await findPriceForMargin(
      input({
        saleFeeCents: 0,
        feeReductionCents: 0,
        shippingCostCents: 1_000,
        productCostCents: 4_000,
        taxRateBps: 1_000,
        adsRateBps: 0,
        fixedCostCents: 0,
      }),
      2_000,
      async (priceCents) => {
        calls += 1
        return { saleFeeCents: Math.round(priceCents * 0.1), shippingCostCents: 1_000 }
      },
      new Date("2026-08-01T13:00:00.000Z"),
    )

    expect(result).toBe(8_333)
    expect(calls).toBeLessThanOrEqual(24)
  })
})
