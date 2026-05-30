import {
  exportProductCostCache,
  loadOrdersForSync,
  primeProductCostCache,
  refreshAccessToken,
} from "@/lib/olist-v3"
import { getStoredCredentials, saveCredentials } from "@/lib/db/credentials"
import { getSyncState, saveSyncState } from "@/lib/db/syncState"
import { upsertOrders } from "@/lib/db/orders"
import { getAllProductCosts, saveProductCosts } from "@/lib/db/productCosts"

export type SyncSummary = {
  ok: true
  ordersSynced: number
  windows: string[]
  frontier: string
  backfillDone: boolean
  elapsedMs: number
}

const BUDGET_MS = Number(process.env.OLIST_SYNC_BUDGET_MS) || 250_000
const RECENT_DAYS = Number(process.env.OLIST_SYNC_RECENT_DAYS) || 15
const BACKFILL_DAYS = Number(process.env.OLIST_SYNC_BACKFILL_DAYS) || 90
const CHUNK_DAYS = Number(process.env.OLIST_SYNC_CHUNK_DAYS) || 15

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function parse(s: string): Date {
  return new Date(`${s}T00:00:00Z`)
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setUTCDate(x.getUTCDate() + n)
  return x
}
function maxDate(a: string, b: string): string {
  return a > b ? a : b
}

export async function runSync(opts: { full?: boolean } = {}): Promise<SyncSummary> {
  const startedAt = Date.now()

  const creds = await getStoredCredentials()
  if (!creds) throw new Error("Sem credenciais Olist no banco. Conecte a conta pelo dashboard primeiro.")

  // Refresh + rotação do refresh token (mantém o job autenticado sem usuário).
  const refreshed = await refreshAccessToken(creds.refreshToken)
  await saveCredentials(refreshed)
  const accessToken = refreshed.access_token

  // Semeia o cache de custo de produto a partir do banco (evita refetch entre runs).
  primeProductCostCache(await getAllProductCosts())

  const state = await getSyncState()
  const today = fmt(new Date())
  const target = fmt(addDays(parse(today), -BACKFILL_DAYS))
  const windows: string[] = []
  let ordersSynced = 0

  // 1. Janela recente — sempre, para capturar novos pedidos e mudanças de status.
  const recentStart = fmt(addDays(parse(today), -RECENT_DAYS))
  ordersSynced += await syncWindow(accessToken, recentStart, today)
  windows.push(`${recentStart}..${today}`)

  // 2. Backfill em chunks indo para trás, dentro do orçamento de tempo. Resumível via cursor.
  let frontier = opts.full ? today : state?.cursorData ?? today
  while (frontier > target && Date.now() - startedAt < BUDGET_MS) {
    const chunkEnd = frontier
    const chunkStart = maxDate(target, fmt(addDays(parse(frontier), -CHUNK_DAYS)))
    ordersSynced += await syncWindow(accessToken, chunkStart, chunkEnd)
    windows.push(`${chunkStart}..${chunkEnd}`)
    frontier = chunkStart
  }
  const backfillDone = frontier <= target

  // Persiste o cache de custo descoberto nesta run.
  await saveProductCosts(exportProductCostCache())

  await saveSyncState({
    cursorData: frontier,
    lastRunAt: new Date(),
    lastSuccessAt: new Date(),
    status: backfillDone ? "live" : "backfilling",
    lastError: null,
    ordersSynced,
  })

  return { ok: true, ordersSynced, windows, frontier, backfillDone, elapsedMs: Date.now() - startedAt }
}

async function syncWindow(accessToken: string, dataInicial: string, dataFinal: string): Promise<number> {
  const orders = await loadOrdersForSync(accessToken, { dataInicial, dataFinal })
  return upsertOrders(orders)
}
