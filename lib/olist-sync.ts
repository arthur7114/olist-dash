import {
  exportProductCostCache,
  primeProductCostCache,
  recomputeCostsForRaws,
  refreshAccessToken,
  syncOrdersIncremental,
} from "@/lib/olist-v3"
import { getStoredCredentials, saveCredentials } from "@/lib/db/credentials"
import { saveSyncState } from "@/lib/db/syncState"
import { getExistingOrderIds, getOrdersMissingCost, updateOrderCost, upsertOrders } from "@/lib/db/orders"
import { getAllProductCosts, saveProductCosts } from "@/lib/db/productCosts"

export type SyncSummary = {
  ok: true
  processed: number
  recentDays: number
  backfillDays: number
  recentCompleted: boolean
  backfillDone: boolean
  elapsedMs: number
}

// Orçamento de tempo por execução — abaixo do maxDuration (300s) da rota, com folga p/
// gravar estado e responder antes do curl/Vercel cortarem.
const BUDGET_MS = Number(process.env.OLIST_SYNC_BUDGET_MS) || 230_000
const RECENT_DAYS = Number(process.env.OLIST_SYNC_RECENT_DAYS) || 15
const BACKFILL_DAYS = Number(process.env.OLIST_SYNC_BACKFILL_DAYS) || 90

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function addDays(base: Date, n: number): Date {
  const x = new Date(base)
  x.setUTCDate(x.getUTCDate() + n)
  return x
}

export async function runSync(opts: { full?: boolean } = {}): Promise<SyncSummary> {
  const startedAt = Date.now()
  const deadline = startedAt + BUDGET_MS

  const creds = await getStoredCredentials()
  if (!creds) throw new Error("Sem credenciais Olist no banco. Conecte a conta pelo dashboard primeiro.")

  // Refresh + rotação do refresh token (mantém o job autenticado sem usuário).
  const refreshed = await refreshAccessToken(creds.refreshToken)
  await saveCredentials(refreshed)
  const accessToken = refreshed.access_token

  // Semeia o cache de custo de produto a partir do banco (evita refetch entre runs).
  primeProductCostCache(await getAllProductCosts())

  const now = new Date()
  const today = fmt(now)
  const recentStart = fmt(addDays(now, -RECENT_DAYS))
  const target = fmt(addDays(now, -BACKFILL_DAYS))

  let processed = 0

  // 1. Janela recente: sempre reprocessa (novos pedidos + mudanças de status).
  const recent = await syncOrdersIncremental(accessToken, {
    dataInicial: recentStart,
    dataFinal: today,
    deadline,
    onBatch: upsertOrders,
  })
  processed += recent.processed

  // 2. Backfill (janela mais antiga), só se a recente terminou e ainda há orçamento.
  //    Pula pedidos já no banco (resumível) — a não ser que full=1 force reprocessar.
  let backfillDone = false
  if (recent.completed && Date.now() < deadline) {
    const existing = opts.full ? null : await getExistingOrderIds(target, recentStart)
    const back = await syncOrdersIncremental(accessToken, {
      dataInicial: target,
      dataFinal: recentStart,
      deadline,
      skip: existing ? (id) => existing.has(id) : undefined,
      onBatch: upsertOrders,
    })
    processed += back.processed
    backfillDone = back.completed
  }

  // Persiste custos descobertos + estado (best-effort; os pedidos já foram gravados em lotes).
  await saveProductCosts(exportProductCostCache())
  await saveSyncState({
    cursorData: backfillDone ? target : recentStart,
    lastRunAt: new Date(),
    lastSuccessAt: new Date(),
    status: backfillDone ? "live" : "backfilling",
    lastError: null,
    ordersSynced: processed,
  })

  return {
    ok: true,
    processed,
    recentDays: RECENT_DAYS,
    backfillDays: BACKFILL_DAYS,
    recentCompleted: recent.completed,
    backfillDone,
    elapsedMs: Date.now() - startedAt,
  }
}

export type RecomputeSummary = {
  ok: true
  totalMissing: number
  scanned: number
  updated: number
  remaining: number
  completed: boolean
  elapsedMs: number
}

// Recalcula o custo de pedidos com custoTotal=0 a partir do detalhe já salvo (`raw`),
// usando o cache de custos (rápido) e buscando na Olist só os que faltam. Resumível: cada
// execução processa o que couber no orçamento de tempo; rode de novo até `completed=true`.
export async function runRecomputeCosts(): Promise<RecomputeSummary> {
  const startedAt = Date.now()
  const deadline = startedAt + BUDGET_MS

  const creds = await getStoredCredentials()
  if (!creds) throw new Error("Sem credenciais Olist no banco. Conecte a conta pelo dashboard primeiro.")
  const refreshed = await refreshAccessToken(creds.refreshToken)
  await saveCredentials(refreshed)
  const accessToken = refreshed.access_token

  // Semeia o cache de custo do banco — a maioria dos custos antigos já está aqui.
  primeProductCostCache(await getAllProductCosts())

  const all = await getOrdersMissingCost(3000)
  let scanned = 0
  let updated = 0
  let completed = true
  const CHUNK = 100

  for (let i = 0; i < all.length; i += CHUNK) {
    if (Date.now() >= deadline) {
      completed = false
      break
    }
    const slice = all.slice(i, i + CHUNK)
    const recomputed = await recomputeCostsForRaws(accessToken, slice.map((r) => r.raw))
    for (let j = 0; j < slice.length; j++) {
      scanned += 1
      const rc = recomputed[j]
      if (rc && rc.custoTotal > 0) {
        await updateOrderCost(slice[j].olistId, rc.custoTotal, rc.quantidade)
        updated += 1
      }
    }
  }

  // Persiste custos recém-descobertos para acelerar as próximas execuções.
  await saveProductCosts(exportProductCostCache())

  return {
    ok: true,
    totalMissing: all.length,
    scanned,
    updated,
    remaining: all.length - scanned,
    completed,
    elapsedMs: Date.now() - startedAt,
  }
}
