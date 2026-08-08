import type { PromotionRecord } from "@oem/contracts"

const ML_API_URL = "https://api.mercadolibre.com"
const MAX_ATTEMPTS = 4

export interface MlCommercialItem {
  id: string
  seller_custom_field?: string | null
  attributes?: Array<{ id?: string; value_name?: string | null }> | null
  variations?: Array<{ seller_custom_field?: string | null }> | null
  title?: string
  category_id?: string
  listing_type_id?: string
  currency_id?: string
  status?: string
  price?: number
  shipping?: {
    mode?: string
    logistic_type?: string
    free_shipping?: boolean
  }
}

export interface CommercialItemSnapshot {
  itemId: string
  sellerSku: string | null
  title: string
  categoryId: string | null
  listingTypeId: string | null
  currencyId: string
  currentPriceCents: number | null
  status: string
  shippingMode: string | null
  logisticType: string | null
  freeShipping: boolean
  raw: unknown
  syncedAt: string
}

export interface NormalizedPromotion extends PromotionRecord {
  minPriceCents: number | null
  maxPriceCents: number | null
  suggestedPriceCents: number | null
  raw: unknown
}

export async function fetchSellerCommercialItemIds(
  sellerId: string,
  accessToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<string[]> {
  const ids: string[] = []
  let offset = 0
  for (;;) {
    const page = await fetchMlCommercialJson<{ results?: string[]; paging?: { total?: number } }>(
      `/users/${encodeURIComponent(sellerId)}/items/search`,
      accessToken,
      { status: "active", limit: 100, offset },
      fetchFn,
    )
    const current = page.results ?? []
    ids.push(...current.map(String))
    if (!current.length || ids.length >= Number(page.paging?.total ?? ids.length)) return ids
    offset += current.length
  }
}

export async function fetchCommercialItemSnapshot(
  itemId: string,
  accessToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<CommercialItemSnapshot> {
  const [item, salePrice, prices] = await Promise.all([
    fetchMlCommercialJson<MlCommercialItem>(`/items/${encodeURIComponent(itemId)}`, accessToken, undefined, fetchFn),
    fetchMlCommercialJson<{ amount?: number }>(
      `/items/${encodeURIComponent(itemId)}/sale_price`,
      accessToken,
      { context: "channel_marketplace" },
      fetchFn,
    ).catch((error) => {
      if (error instanceof MlCommercialHttpError && error.status === 404) return { amount: undefined }
      throw error
    }),
    fetchMlCommercialJson<{ prices?: Array<{ amount?: number }> } | Array<{ amount?: number }>>(
      `/items/${encodeURIComponent(itemId)}/prices`,
      accessToken,
      undefined,
      fetchFn,
    ).catch((error) => {
      if (error instanceof MlCommercialHttpError && error.status === 404) return { prices: [] }
      throw error
    }),
  ])
  const now = new Date().toISOString()
  const priceRows = Array.isArray(prices) ? prices : prices.prices ?? []
  return {
    itemId: String(item.id || itemId),
    sellerSku: resolveSellerSku(item),
    title: cleanString(item.title) ?? String(item.id || itemId),
    categoryId: cleanString(item.category_id),
    listingTypeId: cleanString(item.listing_type_id),
    currencyId: cleanString(item.currency_id) ?? "BRL",
    currentPriceCents: moneyToCents(salePrice.amount ?? priceRows.find((price) => price.amount != null)?.amount ?? item.price),
    status: cleanString(item.status) ?? "unknown",
    shippingMode: cleanString(item.shipping?.mode),
    logisticType: cleanString(item.shipping?.logistic_type),
    freeShipping: Boolean(item.shipping?.free_shipping),
    raw: { item, salePrice, prices },
    syncedAt: now,
  }
}

export async function fetchItemPromotions(
  itemId: string,
  accessToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<NormalizedPromotion[]> {
  const rows = await fetchMlCommercialJson<unknown[]>(
    `/seller-promotions/items/${encodeURIComponent(itemId)}`,
    accessToken,
    { app_version: "v2" },
    fetchFn,
  )
  return rows.map((row) => normalizePromotion(itemId, row))
}

export async function quoteSaleFeeCents(
  input: {
    priceCents: number
    categoryId: string | null
    listingTypeId: string | null
    logisticType: string | null
    shippingMode: string | null
  },
  accessToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<number | null> {
  if (!input.listingTypeId) return null
  const params: Record<string, string | number> = {
    price: input.priceCents / 100,
    listing_type_id: input.listingTypeId,
    currency_id: "BRL",
  }
  if (input.categoryId) params.category_id = input.categoryId
  if (input.logisticType) params.logistic_type = input.logisticType
  if (input.shippingMode) params.shipping_mode = input.shippingMode
  const response = await fetchMlCommercialJson<unknown>("/sites/MLB/listing_prices", accessToken, params, fetchFn)
  const row = Array.isArray(response) ? response[0] : response
  return moneyToCents(asRecord(row).sale_fee_amount)
}

export async function quoteShippingCents(
  input: {
    sellerId: string
    itemId: string
    priceCents: number
    listingTypeId: string | null
    logisticType: string | null
    shippingMode: string | null
    freeShipping: boolean
  },
  accessToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<number | null> {
  const params: Record<string, string | number> = {
    item_id: input.itemId,
    item_price: input.priceCents / 100,
    verbose: "true",
    free_shipping: input.freeShipping ? "true" : "false",
  }
  if (input.listingTypeId) params.listing_type_id = input.listingTypeId
  if (input.logisticType) params.logistic_type = input.logisticType
  if (input.shippingMode) params.mode = input.shippingMode
  const response = await fetchMlCommercialJson<unknown>(
    `/users/${encodeURIComponent(input.sellerId)}/shipping_options/free`,
    accessToken,
    params,
    fetchFn,
  )
  const coverage = asRecord(asRecord(response).coverage)
  return moneyToCents(asRecord(coverage.all_country).list_cost)
}

export function normalizePromotion(itemId: string, value: unknown): NormalizedPromotion {
  const row = asRecord(value)
  const type = cleanString(row.type) ?? "UNKNOWN"
  const promotionId = cleanString(row.id) ?? cleanString(row.promotion_id) ?? "unknown"
  const offerId = cleanString(row.ref_id) ?? cleanString(row.offer_id)
  const candidatePrice = firstMoney(
    row.suggested_discounted_price,
    row.price,
    row.discounted_price,
    row.total_price_for_boosted_offer,
  )
  const syncedAt = new Date().toISOString()
  return {
    key: [itemId, type, promotionId, offerId].filter(Boolean).join(":"),
    itemId,
    promotionId,
    offerId,
    type,
    status: cleanString(row.status) ?? "unknown",
    name: cleanString(row.name) ?? "",
    originalPriceCents: moneyToCents(row.original_price),
    candidatePriceCents: candidatePrice,
    minPriceCents: moneyToCents(row.min_discounted_price),
    maxPriceCents: moneyToCents(row.max_discounted_price),
    suggestedPriceCents: moneyToCents(row.suggested_discounted_price),
    feeReductionCents: firstMoney(row.discount_meli_boost_amount, row.fee_reduction_amount) ?? 0,
    startsAt: isoDate(row.start_date ?? row.start_time),
    endsAt: isoDate(row.finish_date ?? row.end_date ?? row.end_time),
    syncedAt,
    raw: value,
  }
}

export async function fetchMlCommercialJson<T>(
  path: string,
  accessToken: string,
  params?: Record<string, string | number>,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 15_000,
): Promise<T> {
  const url = new URL(path.startsWith("http") ? path : `${ML_API_URL}${path}`)
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, String(value))
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let response: Response
    try {
      response = await Promise.race([
        fetchFn(url, {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
          signal: controller.signal,
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort()
            reject(new MlTimeoutError())
          }, timeoutMs)
        }),
      ])
    } catch (error) {
      if (error instanceof MlTimeoutError) {
        if (attempt < MAX_ATTEMPTS - 1) continue
        throw new Error("Mercado Livre excedeu o tempo limite após novas tentativas.")
      }
      throw error
    } finally {
      if (timer) clearTimeout(timer)
    }
    if (response.ok) return (await response.json()) as T
    if ((response.status === 429 || response.status >= 500) && attempt < MAX_ATTEMPTS - 1) continue
    const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 240)
    throw new MlCommercialHttpError(response.status, detail)
  }
  throw new Error("Mercado Livre indisponível após novas tentativas.")
}

class MlTimeoutError extends Error {}

export class MlCommercialHttpError extends Error {
  constructor(public readonly status: number, detail = "") {
    super(`Mercado Livre retornou ${status}${detail ? `: ${detail}` : "."}`)
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

// A conta OEM não preenche seller_custom_field: o SKU vem no atributo SELLER_SKU.
// Anúncios com variação podem trazê-lo apenas dentro de variations.
export function resolveSellerSku(item: MlCommercialItem): string | null {
  const attribute = item.attributes?.find((entry) => entry.id === "SELLER_SKU")
  return (
    cleanString(item.seller_custom_field) ??
    cleanString(attribute?.value_name) ??
    cleanString(item.variations?.find((variation) => cleanString(variation.seller_custom_field))?.seller_custom_field)
  )
}

function cleanString(value: unknown): string | null {
  const parsed = String(value ?? "").trim()
  return parsed || null
}

export function moneyToCents(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null
}

function firstMoney(...values: unknown[]): number | null {
  for (const value of values) {
    const cents = moneyToCents(value)
    if (cents != null && cents > 0) return cents
  }
  return null
}

function isoDate(value: unknown): string | null {
  if (!value) return null
  const parsed = new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}
