import { z } from "zod"

export const recommendationSchema = z.enum([
  "recommended",
  "review",
  "avoid",
  "incomplete",
])
export type PricingRecommendation = z.infer<typeof recommendationSchema>

const pricingSettingsBaseSchema = z.object({
  taxRateBps: z.number().int().min(0).max(10_000).nullable(),
  adsRateBps: z.number().int().min(0).max(10_000).default(0),
  fixedCostCents: z.number().int().min(0).default(0),
  minimumMarginBps: z.number().int().min(-10_000).max(10_000).nullable(),
  targetMarginBps: z.number().int().min(-10_000).max(10_000).nullable(),
})
export const pricingSettingsSchema = pricingSettingsBaseSchema.superRefine(validateMarginOrder)
export type PricingSettings = z.infer<typeof pricingSettingsSchema>

export const pricingOverrideSchema = z.object({
  scope: z.enum(["item", "sku"]).default("item"),
  itemId: z.string().min(1),
  sellerSku: z.string().nullable().optional(),
  productCostCents: z.number().int().min(0).nullable().optional(),
  shippingCostCents: z.number().int().min(0).nullable().optional(),
  taxRateBps: z.number().int().min(0).max(10_000).nullable().optional(),
  adsRateBps: z.number().int().min(0).max(10_000).nullable().optional(),
  fixedCostCents: z.number().int().min(0).nullable().optional(),
  minimumMarginBps: z.number().int().min(-10_000).max(10_000).nullable().optional(),
  targetMarginBps: z.number().int().min(-10_000).max(10_000).nullable().optional(),
}).superRefine(validateMarginOrder)
export type PricingOverride = z.infer<typeof pricingOverrideSchema>

function validateMarginOrder(
  value: { minimumMarginBps?: number | null; targetMarginBps?: number | null },
  context: z.RefinementCtx,
) {
  if (value.minimumMarginBps != null && value.targetMarginBps != null && value.targetMarginBps < value.minimumMarginBps) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["targetMarginBps"],
      message: "A margem-alvo não pode ser inferior à margem mínima.",
    })
  }
}

export const pricingBreakdownSchema = z.object({
  revenueCents: z.number().int(),
  saleFeeCents: z.number().int(),
  feeReductionCents: z.number().int(),
  shippingCents: z.number().int(),
  productCostCents: z.number().int(),
  taxCents: z.number().int(),
  adsCents: z.number().int(),
  fixedCostCents: z.number().int(),
})
export type PricingBreakdown = z.infer<typeof pricingBreakdownSchema>

export const pricingSourceSchema = z.object({
  field: z.string(),
  source: z.enum(["mercado_livre", "olist", "settings", "override"]),
  updatedAt: z.string().datetime().nullable(),
})

export const pricingEvaluationSchema = z.object({
  item: z.object({
    itemId: z.string(),
    sellerSku: z.string().nullable(),
    title: z.string(),
    currentPriceCents: z.number().int().nullable(),
    candidatePriceCents: z.number().int(),
    currencyId: z.string(),
  }),
  breakdown: pricingBreakdownSchema,
  marginCents: z.number().int(),
  marginBps: z.number().int().nullable(),
  minimumPriceCents: z.number().int().nullable(),
  targetPriceCents: z.number().int().nullable(),
  recommendation: recommendationSchema,
  blockedReasons: z.array(z.string()),
  sources: z.array(pricingSourceSchema),
  stale: z.boolean(),
  calculatedAt: z.string().datetime(),
})
export type PricingEvaluation = z.infer<typeof pricingEvaluationSchema>

export const simulatePricingRequestSchema = z.object({
  itemId: z.string().min(1).max(64),
  candidatePriceCents: z.number().int().positive(),
  includeTargetPrices: z.boolean().optional().default(true),
})
export type SimulatePricingRequest = z.infer<typeof simulatePricingRequestSchema>

export const evaluatePromotionEntrySchema = z.object({
  itemId: z.string().min(1).max(64),
  promotionId: z.string().min(1).max(160),
  type: z.string().min(1).max(80),
  offerId: z.string().max(160).nullable().optional(),
})

export const evaluatePromotionsRequestSchema = z.object({
  entries: z.array(evaluatePromotionEntrySchema).min(1).max(50),
  includeTargetPrices: z.boolean().optional().default(false),
})
export type EvaluatePromotionsRequest = z.infer<typeof evaluatePromotionsRequestSchema>

export const refreshItemsRequestSchema = z.object({
  itemIds: z.array(z.string().min(1).max(64)).min(1).max(50),
})

export const extensionConfigSchema = z.object({
  apiBaseUrl: z.string().url(),
  apiKey: z.string().min(1),
})
export type ExtensionConfig = z.infer<typeof extensionConfigSchema>

export const promotionRecordSchema = z.object({
  key: z.string(),
  itemId: z.string(),
  promotionId: z.string(),
  offerId: z.string().nullable(),
  type: z.string(),
  status: z.string(),
  name: z.string(),
  originalPriceCents: z.number().int().nullable(),
  candidatePriceCents: z.number().int().nullable(),
  feeReductionCents: z.number().int(),
  startsAt: z.string().datetime().nullable(),
  endsAt: z.string().datetime().nullable(),
  syncedAt: z.string().datetime(),
})
export type PromotionRecord = z.infer<typeof promotionRecordSchema>
