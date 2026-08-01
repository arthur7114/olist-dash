import { describe, expect, it } from "vitest"
import { evaluatePromotionsRequestSchema, pricingOverrideSchema, refreshItemsRequestSchema } from "@oem/contracts"

describe("contratos da extensão", () => {
  it("limita avaliações e refreshes a 50 itens", () => {
    const entries = Array.from({ length: 51 }, (_, index) => ({ itemId: `MLB${index}`, promotionId: `P${index}`, type: "DEAL" }))
    expect(evaluatePromotionsRequestSchema.safeParse({ entries }).success).toBe(false)
    expect(refreshItemsRequestSchema.safeParse({ itemIds: entries.map((entry) => entry.itemId) }).success).toBe(false)
  })

  it("aceita null para remover um override e mantém centavos/basis points inteiros", () => {
    expect(pricingOverrideSchema.parse({
      itemId: "MLB123",
      productCostCents: 12_345,
      taxRateBps: 925,
      adsRateBps: null,
      fixedCostCents: null,
    })).toMatchObject({ productCostCents: 12_345, taxRateBps: 925 })
    expect(pricingOverrideSchema.safeParse({ itemId: "MLB123", taxRateBps: 9.25 }).success).toBe(false)
  })
})
