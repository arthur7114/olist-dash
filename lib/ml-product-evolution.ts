export const ML_EVOLUTION_TIMEZONE = "America/Fortaleza"
export const ML_EVOLUTION_MONTHS = 7

export type EvolutionBasis = "paid" | "created"
export type EvolutionMetric = "revenue" | "orders" | "units"
export type EvolutionStatus = "growth" | "decline" | "stable" | "new" | "inactive" | "no_movement"

export interface EvolutionBasisMetrics {
  orders: number
  units: number
  revenue: number
}

export interface MlProductMonthMetric {
  month: string
  productKey: string
  title: string
  itemIds: string[]
  created: EvolutionBasisMetrics
  paid: EvolutionBasisMetrics
  visits: number | null
}

export interface MlEvolutionProduct {
  productKey: string
  title: string
  itemIds: string[]
  totals: {
    created: EvolutionBasisMetrics
    paid: EvolutionBasisMetrics
    visits: number | null
  }
  monthly: Array<Omit<MlProductMonthMetric, "productKey" | "title" | "itemIds">>
}

export interface EvolutionRow extends MlEvolutionProduct {
  previous: number
  current: number
  absoluteChange: number
  percentChange: number | null
  status: EvolutionStatus
  total: number
  visits: number | null
  conversion: number | null
}

export interface MlEvolutionOrderItem {
  quantity?: number
  unit_price?: number
  item?: {
    id?: string
    seller_sku?: string | null
    user_product_id?: string | null
    parent_item_id?: string | null
    title?: string | null
  }
}

export interface MlEvolutionOrder {
  id?: string | number
  status?: string
  tags?: string[]
  order_items?: MlEvolutionOrderItem[]
}

export interface MlEvolutionItemDetail {
  id?: string
  seller_custom_field?: string | null
  user_product_id?: string | null
  parent_item_id?: string | null
  title?: string | null
}

export interface MlProductEvolutionResponse {
  source: "mercado_livre"
  window: {
    months: string[]
    startMonth: string
    endMonth: string
    timezone: typeof ML_EVOLUTION_TIMEZONE
    complete: boolean
  }
  sync: {
    status: string
    coveredMonths: string[]
    lastRun: string | null
    lastSuccess: string | null
  }
  lastSync: string | null
  stale: boolean
  message?: string
  products: MlEvolutionProduct[]
}

type ProductAccumulator = {
  productKey: string
  title: string
  itemIds: Set<string>
  created: EvolutionBasisMetrics
  paid: EvolutionBasisMetrics
  createdOrderIds: Set<string>
  paidOrderIds: Set<string>
}

const EMPTY_METRICS = (): EvolutionBasisMetrics => ({ orders: 0, units: 0, revenue: 0 })

export function completeMonthWindow(reference = new Date(), length = ML_EVOLUTION_MONTHS): string[] {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ML_EVOLUTION_TIMEZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(reference)
  const year = Number(parts.find((p) => p.type === "year")?.value)
  const month = Number(parts.find((p) => p.type === "month")?.value)
  const result: string[] = []

  for (let offset = length; offset >= 1; offset -= 1) {
    const date = new Date(Date.UTC(year, month - 1 - offset, 1))
    result.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`)
  }
  return result
}

export function monthDateRange(month: string): { from: string; to: string } {
  const [year, monthNumber] = month.split("-").map(Number)
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  return {
    from: `${month}-01T00:00:00.000-03:00`,
    to: `${month}-${String(lastDay).padStart(2, "0")}T23:59:59.999-03:00`,
  }
}

export function aggregateMlProductMonth({
  month,
  orders,
  itemDetails,
  visitsByItem,
}: {
  month: string
  orders: MlEvolutionOrder[]
  itemDetails: Map<string, MlEvolutionItemDetail>
  visitsByItem: Map<string, number> | null
}): MlProductMonthMetric[] {
  const products = new Map<string, ProductAccumulator>()
  const seenOrders = new Set<string>()

  for (const order of orders) {
    const orderId = String(order.id ?? "")
    if (!orderId || seenOrders.has(orderId)) continue
    seenOrders.add(orderId)
    const paid = isPaidEligibleOrder(order)

    for (const orderItem of order.order_items ?? []) {
      const itemId = String(orderItem.item?.id ?? "")
      if (!itemId) continue
      const detail = itemDetails.get(itemId)
      const productKey = resolveMlProductKey(orderItem, detail)
      const quantity = Math.max(1, Math.trunc(toNumber(orderItem.quantity, 1)))
      const revenue = roundMoney(toNumber(orderItem.unit_price) * quantity)
      const title = String(orderItem.item?.title || detail?.title || productKey)
      const acc =
        products.get(productKey) ??
        {
          productKey,
          title,
          itemIds: new Set<string>(),
          created: EMPTY_METRICS(),
          paid: EMPTY_METRICS(),
          createdOrderIds: new Set<string>(),
          paidOrderIds: new Set<string>(),
        }

      acc.itemIds.add(itemId)
      acc.created.units += quantity
      acc.created.revenue = roundMoney(acc.created.revenue + revenue)
      acc.createdOrderIds.add(orderId)
      if (paid) {
        acc.paid.units += quantity
        acc.paid.revenue = roundMoney(acc.paid.revenue + revenue)
        acc.paidOrderIds.add(orderId)
      }
      products.set(productKey, acc)
    }
  }

  if (visitsByItem) {
    for (const [itemId, detail] of itemDetails) {
      const productKey = resolveMlProductKey({ item: { id: itemId } }, detail)
      const existing = products.get(productKey)
      if (existing) {
        existing.itemIds.add(itemId)
        continue
      }
      products.set(productKey, {
        productKey,
        title: String(detail.title || productKey),
        itemIds: new Set([itemId]),
        created: EMPTY_METRICS(),
        paid: EMPTY_METRICS(),
        createdOrderIds: new Set(),
        paidOrderIds: new Set(),
      })
    }
  }

  return Array.from(products.values())
    .map((acc) => {
      acc.created.orders = acc.createdOrderIds.size
      acc.paid.orders = acc.paidOrderIds.size
      const itemIds = Array.from(acc.itemIds).sort()
      const visits = visitsByItem
        ? itemIds.reduce((sum, itemId) => sum + (visitsByItem.get(itemId) ?? 0), 0)
        : null
      return {
        month,
        productKey: acc.productKey,
        title: acc.title,
        itemIds,
        created: acc.created,
        paid: acc.paid,
        visits,
      }
    })
    .sort((a, b) => a.productKey.localeCompare(b.productKey, "pt-BR"))
}

export function resolveMlProductKey(
  orderItem: MlEvolutionOrderItem,
  detail?: MlEvolutionItemDetail,
): string {
  return String(
    orderItem.item?.seller_sku ||
      detail?.seller_custom_field ||
      orderItem.item?.user_product_id ||
      detail?.user_product_id ||
      orderItem.item?.parent_item_id ||
      detail?.parent_item_id ||
      orderItem.item?.id ||
      detail?.id ||
      "unmapped",
  )
}

export function isPaidEligibleOrder(order: MlEvolutionOrder): boolean {
  const status = String(order.status ?? "").toLowerCase()
  const tags = (order.tags ?? []).map((tag) => String(tag).toLowerCase())
  return (
    (status === "paid" || status === "confirmed") &&
    !tags.includes("cancelled") &&
    !tags.includes("returned")
  )
}

export function classifyEvolution(previous: number, current: number): EvolutionStatus {
  if (previous === 0 && current === 0) return "no_movement"
  if (previous === 0 && current > 0) return "new"
  if (previous > 0 && current === 0) return "inactive"
  const change = (current - previous) / previous
  if (change > 0.15) return "growth"
  if (change < -0.15) return "decline"
  return "stable"
}

export function metricValue(
  month: MlEvolutionProduct["monthly"][number] | undefined,
  basis: EvolutionBasis,
  metric: EvolutionMetric,
): number {
  return month?.[basis]?.[metric] ?? 0
}

export function evolutionRows(
  products: MlEvolutionProduct[],
  months: string[],
  basis: EvolutionBasis,
  metric: EvolutionMetric,
): EvolutionRow[] {
  const previousMonth = months.at(-2)
  const currentMonth = months.at(-1)

  return products
    .map((product) => {
      const previous = metricValue(product.monthly.find((row) => row.month === previousMonth), basis, metric)
      const current = metricValue(product.monthly.find((row) => row.month === currentMonth), basis, metric)
      const total = product.monthly.reduce((sum, row) => sum + metricValue(row, basis, metric), 0)
      const visitsAvailable = product.monthly.some((row) => row.visits !== null)
      const visits = visitsAvailable
        ? product.monthly.reduce((sum, row) => sum + (row.visits ?? 0), 0)
        : null
      const paidOrders = product.monthly.reduce((sum, row) => sum + row[basis].orders, 0)
      return {
        ...product,
        previous,
        current,
        absoluteChange: roundMoney(current - previous),
        percentChange: previous > 0 ? (current - previous) / previous : null,
        status: classifyEvolution(previous, current),
        total: roundMoney(total),
        visits,
        conversion: visits && visits > 0 ? paidOrders / visits : null,
      }
    })
    .sort((a, b) => Math.abs(b.absoluteChange) - Math.abs(a.absoluteChange))
}

export function groupMonthlyMetrics(
  rows: MlProductMonthMetric[],
  months: string[],
): MlEvolutionProduct[] {
  const products = new Map<string, { title: string; itemIds: Set<string>; rows: Map<string, MlProductMonthMetric> }>()
  for (const row of rows) {
    const current = products.get(row.productKey) ?? {
      title: row.title,
      itemIds: new Set<string>(),
      rows: new Map<string, MlProductMonthMetric>(),
    }
    current.title = row.title || current.title
    row.itemIds.forEach((itemId) => current.itemIds.add(itemId))
    current.rows.set(row.month, row)
    products.set(row.productKey, current)
  }

  return Array.from(products.entries())
    .map(([productKey, product]) => {
      const monthly = months.map((month) => {
        const row = product.rows.get(month)
        return row
          ? { month, created: row.created, paid: row.paid, visits: row.visits }
          : { month, created: EMPTY_METRICS(), paid: EMPTY_METRICS(), visits: null }
      })
      const visitsAvailable = monthly.some((row) => row.visits !== null)
      return {
        productKey,
        title: product.title,
        itemIds: Array.from(product.itemIds).sort(),
        totals: {
          created: sumBasis(monthly, "created"),
          paid: sumBasis(monthly, "paid"),
          visits: visitsAvailable
            ? monthly.reduce((sum, row) => sum + (row.visits ?? 0), 0)
            : null,
        },
        monthly,
      }
    })
    .sort((a, b) => a.productKey.localeCompare(b.productKey, "pt-BR"))
}

function sumBasis(
  monthly: MlEvolutionProduct["monthly"],
  basis: EvolutionBasis,
): EvolutionBasisMetrics {
  return monthly.reduce(
    (total, row) => ({
      orders: total.orders + row[basis].orders,
      units: total.units + row[basis].units,
      revenue: roundMoney(total.revenue + row[basis].revenue),
    }),
    EMPTY_METRICS(),
  )
}

export function pendingEvolutionMonths(
  windowMonths: string[],
  full: boolean,
  state: { status: string; cursorMonth: string | null } | null,
): { mode: "backfilling" | "refreshing"; pending: string[] } {
  const mode = full ? "backfilling" : "refreshing"
  const defaultMonths = full ? windowMonths : windowMonths.slice(-2)
  const resumable = state?.status === mode || state?.status === `${mode}_error`
  const resumeAt = resumable ? state?.cursorMonth : null
  const startIndex = resumeAt && defaultMonths.includes(resumeAt) ? defaultMonths.indexOf(resumeAt) : 0
  return { mode, pending: defaultMonths.slice(startIndex) }
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}
