import { asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm"
import type { PricingOverride, PricingSettings } from "@oem/contracts"
import { getDb } from "./client"
import {
  mlCommercialSyncState,
  mlItems,
  mlPromotions,
  pricingOverrides,
  pricingSettings,
  productCosts,
} from "./schema"
import type { CommercialItemSnapshot, NormalizedPromotion } from "@/lib/ml-commercial"

export type MlItemRow = typeof mlItems.$inferSelect
export type MlPromotionRow = typeof mlPromotions.$inferSelect

export async function upsertMlItems(rows: CommercialItemSnapshot[]): Promise<void> {
  if (!rows.length) return
  const db = getDb()
  await db.insert(mlItems).values(rows.map((row) => ({
    itemId: row.itemId,
    sellerSku: row.sellerSku,
    title: row.title,
    categoryId: row.categoryId,
    listingTypeId: row.listingTypeId,
    currencyId: row.currencyId,
    currentPrice: centsToDb(row.currentPriceCents),
    status: row.status,
    shippingMode: row.shippingMode,
    logisticType: row.logisticType,
    freeShipping: row.freeShipping ? 1 : 0,
    raw: row.raw,
    syncedAt: new Date(row.syncedAt),
  }))).onConflictDoUpdate({
    target: mlItems.itemId,
    set: {
      sellerSku: sql`excluded.seller_sku`,
      title: sql`excluded.title`,
      categoryId: sql`excluded.category_id`,
      listingTypeId: sql`excluded.listing_type_id`,
      currencyId: sql`excluded.currency_id`,
      currentPrice: sql`excluded.current_price`,
      status: sql`excluded.status`,
      shippingMode: sql`excluded.shipping_mode`,
      logisticType: sql`excluded.logistic_type`,
      freeShipping: sql`excluded.free_shipping`,
      raw: sql`excluded.raw`,
      syncedAt: sql`excluded.synced_at`,
    },
  })
}

export async function replaceMlItemPromotions(itemId: string, rows: NormalizedPromotion[]): Promise<void> {
  const db = getDb()
  await db.transaction(async (tx) => {
    await tx.delete(mlPromotions).where(eq(mlPromotions.itemId, itemId))
    if (!rows.length) return
    await tx.insert(mlPromotions).values(rows.map((row) => ({
      key: row.key,
      itemId: row.itemId,
      promotionId: row.promotionId,
      offerId: row.offerId,
      type: row.type,
      status: row.status,
      name: row.name,
      originalPrice: centsToDb(row.originalPriceCents),
      candidatePrice: centsToDb(row.candidatePriceCents),
      minPrice: centsToDb(row.minPriceCents),
      maxPrice: centsToDb(row.maxPriceCents),
      suggestedPrice: centsToDb(row.suggestedPriceCents),
      feeReduction: centsToDb(row.feeReductionCents) ?? "0",
      startsAt: row.startsAt ? new Date(row.startsAt) : null,
      endsAt: row.endsAt ? new Date(row.endsAt) : null,
      raw: row.raw,
      syncedAt: new Date(row.syncedAt),
    })))
  })
}

export async function getMlItem(itemId: string): Promise<MlItemRow | null> {
  const [row] = await getDb().select().from(mlItems).where(eq(mlItems.itemId, itemId)).limit(1)
  return row ?? null
}

export async function listMlItems(search = "", limit = 500): Promise<MlItemRow[]> {
  const db = getDb()
  const query = db.select().from(mlItems)
  const rows = search.trim()
    ? await query.where(or(
      ilike(mlItems.itemId, `%${search.trim()}%`),
      ilike(mlItems.sellerSku, `%${search.trim()}%`),
      ilike(mlItems.title, `%${search.trim()}%`),
    )).orderBy(asc(mlItems.title)).limit(limit)
    : await query.orderBy(asc(mlItems.title)).limit(limit)
  return rows
}

export async function listMlPromotions(limit = 1000): Promise<MlPromotionRow[]> {
  return getDb().select().from(mlPromotions).orderBy(desc(mlPromotions.syncedAt)).limit(limit)
}

export async function getMlPromotion(key: string): Promise<MlPromotionRow | null> {
  const [row] = await getDb().select().from(mlPromotions).where(eq(mlPromotions.key, key)).limit(1)
  return row ?? null
}

export async function getPricingSettings(): Promise<PricingSettings> {
  const [row] = await getDb().select().from(pricingSettings).where(eq(pricingSettings.id, 1)).limit(1)
  return {
    taxRateBps: row?.taxRateBps ?? null,
    adsRateBps: row?.adsRateBps ?? 0,
    fixedCostCents: dbMoneyToCents(row?.fixedCost ?? "0") ?? 0,
    minimumMarginBps: row?.minimumMarginBps ?? null,
    targetMarginBps: row?.targetMarginBps ?? null,
  }
}

export async function savePricingSettings(settings: PricingSettings): Promise<PricingSettings> {
  await getDb().insert(pricingSettings).values({
    id: 1,
    taxRateBps: settings.taxRateBps,
    adsRateBps: settings.adsRateBps,
    fixedCost: centsToDb(settings.fixedCostCents) ?? "0",
    minimumMarginBps: settings.minimumMarginBps,
    targetMarginBps: settings.targetMarginBps,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: pricingSettings.id,
    set: {
      taxRateBps: settings.taxRateBps,
      adsRateBps: settings.adsRateBps,
      fixedCost: centsToDb(settings.fixedCostCents) ?? "0",
      minimumMarginBps: settings.minimumMarginBps,
      targetMarginBps: settings.targetMarginBps,
      updatedAt: new Date(),
    },
  })
  return settings
}

export async function getPricingOverride(itemId: string): Promise<PricingOverride | null> {
  const [row] = await getDb().select().from(pricingOverrides).where(eq(pricingOverrides.itemId, itemId)).limit(1)
  if (!row) return null
  return {
    itemId: row.itemId,
    sellerSku: row.sellerSku,
    productCostCents: dbMoneyToCents(row.productCost),
    shippingCostCents: dbMoneyToCents(row.shippingCost),
    taxRateBps: row.taxRateBps ?? undefined,
    adsRateBps: row.adsRateBps ?? undefined,
    fixedCostCents: row.fixedCost == null ? undefined : dbMoneyToCents(row.fixedCost) ?? undefined,
    minimumMarginBps: row.minimumMarginBps ?? undefined,
    targetMarginBps: row.targetMarginBps ?? undefined,
  }
}

export async function savePricingOverride(value: PricingOverride): Promise<PricingOverride> {
  const row = {
    itemId: value.itemId,
    sellerSku: value.sellerSku ?? null,
    productCost: centsToDb(value.productCostCents ?? null),
    shippingCost: centsToDb(value.shippingCostCents ?? null),
    taxRateBps: value.taxRateBps ?? null,
    adsRateBps: value.adsRateBps ?? null,
    fixedCost: centsToDb(value.fixedCostCents ?? null),
    minimumMarginBps: value.minimumMarginBps ?? null,
    targetMarginBps: value.targetMarginBps ?? null,
    updatedAt: new Date(),
  }
  await getDb().insert(pricingOverrides).values(row).onConflictDoUpdate({
    target: pricingOverrides.itemId,
    set: row,
  })
  return value
}

export async function resolveProductCostCents(item: MlItemRow, override: PricingOverride | null): Promise<number | null> {
  if (override?.productCostCents != null) return override.productCostCents
  const refs = [`id:${item.itemId}`]
  if (item.sellerSku) refs.unshift(`sku:${item.sellerSku}`)
  const rows = await getDb().select().from(productCosts).where(inArray(productCosts.ref, refs)).limit(refs.length)
  const preferred = refs.map((ref) => rows.find((row) => row.ref === ref)).find(Boolean)
  return preferred ? dbMoneyToCents(preferred.custo) : null
}

export async function getCommercialSyncState() {
  const [row] = await getDb().select().from(mlCommercialSyncState)
    .where(eq(mlCommercialSyncState.id, 1)).limit(1)
  return row ?? null
}

export async function getPricingCoverage(): Promise<{ totalItems: number; itemsWithCost: number }> {
  const result = await getDb().execute(sql`
    select count(*)::int as "totalItems",
      (count(*) filter (where po.product_cost is not null or pc.custo is not null))::int as "itemsWithCost"
    from ml_items mi
    left join pricing_overrides po on po.item_id = mi.item_id
    left join product_costs pc on pc.ref = ('sku:' || mi.seller_sku)
  `)
  const row = result.rows[0] as { totalItems?: number | string; itemsWithCost?: number | string } | undefined
  return { totalItems: Number(row?.totalItems ?? 0), itemsWithCost: Number(row?.itemsWithCost ?? 0) }
}

export async function saveCommercialSyncState(patch: Partial<typeof mlCommercialSyncState.$inferInsert>) {
  const current = await getCommercialSyncState()
  const next = { ...(current ?? {}), ...patch, id: 1 }
  await getDb().insert(mlCommercialSyncState).values(next).onConflictDoUpdate({
    target: mlCommercialSyncState.id,
    set: next,
  })
  return next
}

export function dbMoneyToCents(value: string | number | null | undefined): number | null {
  if (value == null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null
}

function centsToDb(value: number | null | undefined): string | null {
  return value == null ? null : (value / 100).toFixed(2)
}
