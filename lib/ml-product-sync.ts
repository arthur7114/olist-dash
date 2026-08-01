import {
  aggregateMlProductMonth,
  monthDateRange,
  type MlEvolutionItemDetail,
  type MlEvolutionOrder,
  type MlProductMonthMetric,
} from "@/lib/ml-product-evolution"

const ML_API_URL = "https://api.mercadolibre.com"
const MAX_ATTEMPTS = 4

type DelayFn = (ms: number) => Promise<unknown>
const defaultDelay: DelayFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export interface MlEvolutionSyncContext {
  sellerId: string
  catalogItemIds: string[]
  itemDetails: Map<string, MlEvolutionItemDetail>
}

export async function fetchMlJson<T>(
  path: string,
  accessToken: string,
  params?: Record<string, string | number>,
  fetchFn: typeof fetch = fetch,
  delayFn: DelayFn = defaultDelay,
): Promise<T> {
  const url = new URL(path.startsWith("http") ? path : `${ML_API_URL}${path}`)
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, String(value))

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const response = await fetchFn(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    })
    if (response.ok) return (await response.json()) as T

    const retryable = response.status === 429 || response.status >= 500
    if (retryable && attempt < MAX_ATTEMPTS - 1) {
      const retryAfter = Number(response.headers.get("retry-after"))
      const waitMs = Number.isFinite(retryAfter) && retryAfter >= 0
        ? retryAfter * 1000
        : Math.min(8_000, 500 * 2 ** attempt)
      await delayFn(waitMs)
      continue
    }

    const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 240)
    throw new Error(`Mercado Livre retornou ${response.status}${detail ? `: ${detail}` : "."}`)
  }
  throw new Error("Mercado Livre indisponível após novas tentativas.")
}

export async function createMlEvolutionSyncContext(
  accessToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<MlEvolutionSyncContext> {
  const me = await fetchMlJson<{ id: string | number }>("/users/me", accessToken, undefined, fetchFn)
  const sellerId = String(me.id)
  const catalogItemIds = await fetchPaged<string>(
    `/users/${sellerId}/items/search`,
    accessToken,
    {},
    fetchFn,
    100,
  )
  const itemDetails = await fetchMlItemDetails(catalogItemIds, accessToken, fetchFn)
  return { sellerId, catalogItemIds, itemDetails }
}

export async function syncMlProductMonth(
  month: string,
  context: MlEvolutionSyncContext,
  accessToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<MlProductMonthMetric[]> {
  const orders = await fetchMlOrdersForMonth(month, context.sellerId, accessToken, fetchFn)
  const orderItemIds = orders.flatMap((order) =>
    (order.order_items ?? []).map((item) => String(item.item?.id ?? "")).filter(Boolean),
  )
  const allItemIds = Array.from(new Set([...context.catalogItemIds, ...orderItemIds])).sort()
  const missingDetails = allItemIds.filter((id) => !context.itemDetails.has(id))
  if (missingDetails.length) {
    const fetched = await fetchMlItemDetails(missingDetails, accessToken, fetchFn)
    for (const [id, detail] of fetched) context.itemDetails.set(id, detail)
  }
  let visitsByItem: Map<string, number> | null = null
  try {
    visitsByItem = await fetchMlVisitsForMonth(month, allItemIds, accessToken, fetchFn)
  } catch {
    // Visits are supplementary. Sales remain publishable when ML denies or
    // temporarily fails this endpoint; the public contract exposes null.
    visitsByItem = null
  }

  return aggregateMlProductMonth({
    month,
    orders,
    itemDetails: context.itemDetails,
    visitsByItem,
  })
}

export async function fetchMlOrdersForMonth(
  month: string,
  sellerId: string,
  accessToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<MlEvolutionOrder[]> {
  const range = monthDateRange(month)
  return fetchPaged<MlEvolutionOrder>(
    "/orders/search",
    accessToken,
    {
      seller: sellerId,
      "order.date_created.from": range.from,
      "order.date_created.to": range.to,
      sort: "date_asc",
    },
    fetchFn,
    50,
  )
}

export async function fetchMlItemDetails(
  itemIds: string[],
  accessToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<Map<string, MlEvolutionItemDetail>> {
  const result = new Map<string, MlEvolutionItemDetail>()
  const batches: string[][] = []
  for (let i = 0; i < itemIds.length; i += 20) batches.push(itemIds.slice(i, i + 20))

  await mapConcurrent(batches, 4, async (batch) => {
    const response = await fetchMlJson<Array<{ code?: number; body?: MlEvolutionItemDetail }>>(
      "/items",
      accessToken,
      { ids: batch.join(",") },
      fetchFn,
    )
    for (const record of response) {
      if (record.code === 200 && record.body?.id) result.set(String(record.body.id), record.body)
    }
  })
  return result
}

export async function fetchMlVisitsForMonth(
  month: string,
  itemIds: string[],
  accessToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<Map<string, number>> {
  const [, monthNumber] = month.split("-").map(Number)
  const days = new Date(Date.UTC(Number(month.slice(0, 4)), monthNumber, 0)).getUTCDate()
  const ending = `${month}-${String(days).padStart(2, "0")}`
  const visits = new Map<string, number>()

  await mapConcurrent(itemIds, 8, async (itemId) => {
    const response = await fetchMlJson<{ results?: Array<{ total?: number }> }>(
      `/items/${encodeURIComponent(itemId)}/visits/time_window`,
      accessToken,
      { last: days, unit: "day", ending },
      fetchFn,
    )
    visits.set(
      itemId,
      (response.results ?? []).reduce((sum, row) => sum + finiteNumber(row.total), 0),
    )
  })
  return visits
}

async function fetchPaged<T>(
  path: string,
  accessToken: string,
  params: Record<string, string | number>,
  fetchFn: typeof fetch,
  limit: number,
): Promise<T[]> {
  const rows: T[] = []
  let offset = 0
  for (;;) {
    const page = await fetchMlJson<{ results?: T[]; paging?: { total?: number } }>(
      path,
      accessToken,
      { ...params, limit, offset },
      fetchFn,
    )
    const current = page.results ?? []
    rows.push(...current)
    const total = finiteNumber(page.paging?.total, rows.length)
    if (!current.length || rows.length >= total) return rows
    offset += current.length
  }
}

async function mapConcurrent<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = next
      next += 1
      if (index >= items.length) return
      await worker(items[index])
    }
  })
  await Promise.all(runners)
}

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
