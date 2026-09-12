import {
  exportProductCostCache,
  fetchCostsBySku,
  fetchNotaFactsByIds,
  markProductCostsPersisted,
  primeProductCostCache,
  recomputeCostsForRaws,
  refreshAccessToken,
  syncOrdersIncremental,
  type TinyOrderDetail,
} from "@/lib/olist-v3"
import { getStoredCredentials, saveCredentials } from "@/lib/db/credentials"
import { saveSyncState } from "@/lib/db/syncState"
import {
  clearOrderNotaFacts,
  getBackfillSkipIds,
  getOrdersMissingCost,
  getOrdersMissingNotaValue,
  updateOrderCost,
  updateOrderNotaFacts,
  upsertOrders,
} from "@/lib/db/orders"
import { getAllProductCosts, getSkusMissingCost, getSkusStaleCost, saveProductCosts } from "@/lib/db/productCosts"

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
// Idade máxima de um pedido ainda mutável antes de ser revisto pelo backfill. 72h mantém
// a carga diária (~1/3 do backlog) bem abaixo da capacidade da janela de execução, e a
// janela recente já cobre os pedidos novos todos os dias.
const REFRESH_STALE_HOURS = Number(process.env.OLIST_REFRESH_STALE_HOURS) || 72

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function addDays(base: Date, n: number): Date {
  const x = new Date(base)
  x.setUTCDate(x.getUTCDate() + n)
  return x
}

async function persistProductCostCache(): Promise<void> {
  const entries = exportProductCostCache()
  await saveProductCosts(entries)
  markProductCostsPersisted(entries)
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
  //    Pula o que está liquidado ou foi revisto há menos de REFRESH_STALE_HOURS — o resto
  //    é rebuscado. É isso que mantém situação, valor e NF em dia depois que o pedido sai
  //    da janela recente (curta em produção: RECENT_DAYS=2). Com full=1, refaz tudo.
  let backfillDone = false
  if (recent.completed && Date.now() < deadline) {
    const skip = opts.full ? null : await getBackfillSkipIds(target, recentStart, REFRESH_STALE_HOURS)
    const back = await syncOrdersIncremental(accessToken, {
      dataInicial: target,
      dataFinal: recentStart,
      deadline,
      skip: skip ? (id) => skip.has(id) : undefined,
      onBatch: upsertOrders,
    })
    processed += back.processed
    backfillDone = back.completed
  }

  // Persiste custos descobertos + estado (best-effort; os pedidos já foram gravados em lotes).
  await persistProductCostCache()
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
  await persistProductCostCache()

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

// Preenche valorNota dos pedidos já sincronizados a partir do idNotaFiscal salvo no raw.
// Busca os valores por janela (min..max das datas do lote) e atualiza pedido a pedido.
// Resumível: rode de novo até completed=true.
export async function runBackfillNotas(): Promise<{
  ok: true
  totalMissing: number
  scanned: number
  updated: number
  remaining: number
  completed: boolean
  elapsedMs: number
}> {
  const startedAt = Date.now()
  const deadline = startedAt + BUDGET_MS

  const creds = await getStoredCredentials()
  if (!creds) throw new Error("Sem credenciais Olist no banco. Conecte a conta pelo dashboard primeiro.")
  const refreshed = await refreshAccessToken(creds.refreshToken)
  await saveCredentials(refreshed)
  const accessToken = refreshed.access_token

  const all = await getOrdersMissingNotaValue(3000)
  let scanned = 0
  let updated = 0
  let completed = true
  const CHUNK = 200

  for (let i = 0; i < all.length; i += CHUNK) {
    if (Date.now() >= deadline) {
      completed = false
      break
    }
    const slice = all.slice(i, i + CHUNK)
    const idsNota = slice.flatMap((o) => {
      const idNota = (o.raw as TinyOrderDetail)?.idNotaFiscal
      return idNota == null ? [] : [idNota]
    })
    const notaFacts = await fetchNotaFactsByIds(accessToken, idsNota)
    for (const o of slice) {
      scanned += 1
      const idNota = (o.raw as TinyOrderDetail)?.idNotaFiscal
      const nota = idNota != null ? notaFacts.get(idNota) : undefined
      if (nota?.cancelada) {
        await clearOrderNotaFacts(o.olistId)
        updated += 1
      } else if (nota && nota.valor > 0 && nota.dataEmissao) {
        await updateOrderNotaFacts(o.olistId, nota.valor, nota.dataEmissao)
        updated += 1
      }
    }
  }

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

export type BackfillCostsSummary = {
  ok: true
  /** SKUs de anúncios ativos que estavam sem custo antes desta execução. */
  totalMissing: number
  /** Quantos foram consultados na Olist nesta execução. */
  scanned: number
  /** Quantos passaram a ter custo. */
  filled: number
  /** Custos já existentes que foram relidos da Olist por estarem velhos. */
  refreshed: number
  /** Desses, quantos mudaram de valor (entrada de estoque mexeu no custo médio). */
  changed: number
  /** Existem na Olist, mas com o custo em branco no cadastro: alguém precisa preencher lá. */
  semCustoNaOlist: string[]
  /** Não foram encontrados na Olist por esse SKU: cadastro divergente entre anúncio e ERP. */
  naoEncontrados: string[]
  remaining: number
  completed: boolean
  durationMs: number
}

// Preenche o custo dos produtos que nunca venderam. O sync normal só busca custo de produto
// que apareceu em pedido; anúncio ativo que nunca vendeu fica sem custo para sempre, e sem
// custo não há preço nem promoção. Resumível: rode de novo até remaining = 0.
export async function runBackfillListingCosts(
  options: { limit?: number; refreshDays?: number } = {},
): Promise<BackfillCostsSummary> {
  const startedAt = Date.now()
  const deadline = startedAt + BUDGET_MS

  const creds = await getStoredCredentials()
  if (!creds) throw new Error("Sem credenciais Olist no banco. Conecte a conta pelo dashboard primeiro.")
  const refreshed = await refreshAccessToken(creds.refreshToken)
  await saveCredentials(refreshed)

  const limit = options.limit ?? 500
  const missing = await getSkusMissingCost(limit)
  // Sobrou orçamento? Reler os custos velhos: é assim que uma entrada de estoque na Olist
  // chega até aqui num produto que não vende há semanas.
  const refreshDays = options.refreshDays ?? 7
  const stale = refreshDays > 0 && missing.length < limit
    ? await getSkusStaleCost(refreshDays, limit - missing.length)
    : []
  const anteriores = new Map(
    (await getAllProductCosts())
      .filter((c) => c.ref.startsWith("sku:"))
      .map((c) => [c.ref.slice(4), c.custo]),
  )
  const eraStale = new Set(stale)
  const costs = await fetchCostsBySku(refreshed.access_token, [...missing, ...stale], { deadline })

  const paraGravar: Array<{ ref: string; custo: number }> = []
  const semCustoNaOlist: string[] = []
  const naoEncontrados: string[] = []
  let changed = 0
  for (const sku of [...missing, ...stale]) {
    const r = costs.get(sku)
    if (!r) continue
    if (!r.found) { naoEncontrados.push(sku); continue }
    if (r.cost > 0) {
      const antes = anteriores.get(sku)
      if (antes !== undefined && Math.abs(antes - r.cost) > 0.005) changed += 1
      paraGravar.push({ ref: `sku:${sku}`, custo: r.cost })
      if (typeof r.id === "number") paraGravar.push({ ref: `id:${r.id}`, custo: r.cost })
    } else if (!eraStale.has(sku)) semCustoNaOlist.push(sku)
  }
  await saveProductCosts(paraGravar)

  const scanned = costs.size
  const gravados = paraGravar.filter((e) => e.ref.startsWith("sku:")).map((e) => e.ref.slice(4))
  const alvo = missing.length + stale.length
  return {
    ok: true,
    totalMissing: missing.length,
    scanned,
    filled: gravados.filter((s) => !anteriores.has(s)).length,
    refreshed: gravados.filter((s) => anteriores.has(s)).length,
    changed,
    semCustoNaOlist,
    naoEncontrados,
    remaining: alvo - scanned,
    completed: scanned >= alvo,
    durationMs: Date.now() - startedAt,
  }
}
