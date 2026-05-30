import {
  exportProductCostCache,
  primeProductCostCache,
  refreshAccessToken,
  syncOrdersIncremental,
} from "@/lib/olist-v3"
import { getStoredCredentials, saveCredentials } from "@/lib/db/credentials"
import { saveSyncState } from "@/lib/db/syncState"
import { getExistingOrderIds, upsertOrders } from "@/lib/db/orders"
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
