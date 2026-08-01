import { asc, eq, inArray } from "drizzle-orm"
import { getDb } from "./client"
import { mlProductEvolutionSyncState, mlProductMonthlyMetrics } from "./schema"
import type { MlProductMonthMetric } from "@/lib/ml-product-evolution"

export interface MlEvolutionSyncState {
  status: string
  cursorMonth: string | null
  coveredMonths: string[]
  lastRunAt: Date | null
  lastSuccessAt: Date | null
  lastError: string | null
}

export async function replaceMlProductMonth(month: string, rows: MlProductMonthMetric[]): Promise<void> {
  const db = getDb()
  const monthDate = `${month}-01`
  const now = new Date()
  const removePrevious = db
    .delete(mlProductMonthlyMetrics)
    .where(eq(mlProductMonthlyMetrics.month, monthDate))

  if (!rows.length) {
    await db.batch([removePrevious])
    return
  }

  const publishCurrent = db.insert(mlProductMonthlyMetrics).values(
    rows.map((row) => ({
      month: monthDate,
      productKey: row.productKey,
      title: row.title,
      itemIds: row.itemIds,
      createdOrders: row.created.orders,
      createdUnits: row.created.units,
      createdRevenue: String(row.created.revenue),
      paidOrders: row.paid.orders,
      paidUnits: row.paid.units,
      paidRevenue: String(row.paid.revenue),
      visits: row.visits,
      syncedAt: now,
    })),
  )

  // Neon HTTP não expõe db.transaction(), mas batch é enviado como uma única
  // transação pela API do Neon: delete e insert publicam o mês juntos.
  await db.batch([removePrevious, publishCurrent])
}

export async function getMlProductMonths(months: string[]): Promise<MlProductMonthMetric[]> {
  if (!months.length) return []
  const rows = await getDb()
    .select()
    .from(mlProductMonthlyMetrics)
    .where(inArray(mlProductMonthlyMetrics.month, months.map((month) => `${month}-01`)))
    .orderBy(asc(mlProductMonthlyMetrics.month), asc(mlProductMonthlyMetrics.productKey))

  return rows.map((row) => ({
    month: row.month.slice(0, 7),
    productKey: row.productKey,
    title: row.title,
    itemIds: row.itemIds,
    created: {
      orders: row.createdOrders,
      units: row.createdUnits,
      revenue: Number(row.createdRevenue),
    },
    paid: {
      orders: row.paidOrders,
      units: row.paidUnits,
      revenue: Number(row.paidRevenue),
    },
    visits: row.visits,
  }))
}

export async function getMlEvolutionCoveredMonths(months?: string[]): Promise<string[]> {
  const db = getDb()
  const base = db.selectDistinct({ month: mlProductMonthlyMetrics.month }).from(mlProductMonthlyMetrics)
  const rows = months?.length
    ? await base.where(inArray(mlProductMonthlyMetrics.month, months.map((month) => `${month}-01`)))
    : await base
  return rows.map((row) => row.month.slice(0, 7)).sort()
}

export async function getMlEvolutionSyncState(): Promise<MlEvolutionSyncState | null> {
  const [row] = await getDb()
    .select()
    .from(mlProductEvolutionSyncState)
    .where(eq(mlProductEvolutionSyncState.id, 1))
    .limit(1)
  if (!row) return null
  return {
    status: row.status,
    cursorMonth: row.cursorMonth,
    coveredMonths: row.coveredMonths,
    lastRunAt: row.lastRunAt,
    lastSuccessAt: row.lastSuccessAt,
    lastError: row.lastError,
  }
}

export async function saveMlEvolutionSyncState(
  patch: Partial<MlEvolutionSyncState>,
): Promise<MlEvolutionSyncState> {
  const current = (await getMlEvolutionSyncState()) ?? {
    status: "idle",
    cursorMonth: null,
    coveredMonths: [],
    lastRunAt: null,
    lastSuccessAt: null,
    lastError: null,
  }
  const next = { ...current, ...patch }
  await getDb()
    .insert(mlProductEvolutionSyncState)
    .values({ id: 1, ...next })
    .onConflictDoUpdate({
      target: mlProductEvolutionSyncState.id,
      set: next,
    })
  return next
}
