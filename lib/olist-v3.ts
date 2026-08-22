import type { FormaPagamento, Pedido, StatusPagamento } from "@/lib/data"
import { extractOrderItems, type SyncOrderItem } from "@/lib/olist-items"

export const OLIST_AUTH_URL =
  "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth"
export const OLIST_TOKEN_URL =
  "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token"
export const OLIST_API_URL = "https://api.tiny.com.br/public-api/v3"

export const OLIST_ACCESS_COOKIE = "olist_access_token"
export const OLIST_REFRESH_COOKIE = "olist_refresh_token"
export const OLIST_STATE_COOKIE = "olist_oauth_state"

export type TinyTokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
}

type OrderPeriod = "7d" | "15d" | "30d" | "tudo"

class TinyApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
  }
}

type TinyListResponse<T> = {
  itens?: T[]
  paginacao?: {
    total?: number
    limit?: number
    offset?: number
  }
}

type TinyOrderListItem = {
  id?: number
  numeroPedido?: number
  ecommerce?: {
    nome?: string
    canalVenda?: string
    numeroPedidoEcommerce?: string
    numeroPedidoCanalVenda?: string
  }
  dataCriacao?: string
  valor?: string | number
  situacao?: number
  vendedor?: {
    nome?: string
  }
  transportador?: {
    nome?: string
  }
}

export type TinyOrderDetail = TinyOrderListItem & {
  idNotaFiscal?: number
  data?: string
  dataFaturamento?: string
  valorTotalProdutos?: number
  valorTotalPedido?: number
  valorFrete?: number
  valorDesconto?: number
  valorOutrasDespesas?: number // onde a tarifa/comissão do marketplace cai quando importada como despesa
  situacao?: number
  ecommerce?: TinyOrderListItem["ecommerce"]
  intermediador?: {
    nome?: string
  }
  pagamento?: {
    formaRecebimento?: {
      nome?: string
    }
    meioPagamento?: {
      nome?: string
    }
    formaPagamento?: {
      nome?: string
    }
    parcelas?: Array<{
      valor?: number
      formaRecebimento?: {
        nome?: string
      }
      meioPagamento?: {
        nome?: string
      }
      formaPagamento?: {
        nome?: string
      }
    }>
  }
  itens?: Array<{
    produto?: {
      id?: number
      sku?: string
      descricao?: string
    }
    quantidade?: number
    valorUnitario?: number
  }>
  pagamentosIntegrados?: Array<{
    formaRecebimento?: {
      nome?: string
    }
    meioPagamento?: {
      nome?: string
    }
    formaPagamento?: {
      nome?: string
    }
    tipoPagamento?: number
  }>
}

type TinyProductDetail = {
  id?: number
  sku?: string
  precos?: {
    precoCusto?: number
    precoCustoMedio?: number
  }
}

// Item da listagem de notas fiscais (v3), confirmado contra o swagger público
// (ListagemNotaFiscalModelResponse): id é integer, valor é number. situacao é o
// enum de status da nota (1 Pendente, 2 Emitida, 3 Cancelada, ... 10 Denegada).
export type TinyNotaListItem = {
  id?: number
  valor?: number
  situacao?: number | string
}

const SITUACAO_NOTA_CANCELADA = 3

// Indexa id-da-nota → valor, para casar com order.idNotaFiscal. Ignora entradas
// inválidas e notas canceladas (situacao 3) — uma NF cancelada não deve contar
// como faturamento.
export function indexNotaValues(notas: TinyNotaListItem[]): Map<number, number> {
  const map = new Map<number, number>()
  for (const nota of notas) {
    if (nota.id == null) continue
    if (Number(nota.situacao) === SITUACAO_NOTA_CANCELADA) continue
    const valor = toNumber(nota.valor)
    if (valor > 0) map.set(nota.id, valor)
  }
  return map
}

type TinyProductListItem = TinyProductDetail & {
  descricao?: string
}

type TinyProductCostList = {
  itens?: Array<{
    precoCusto?: number
    custoMedio?: number
  }>
}

type ProductCostLookup = {
  byId: Map<number, number>
  bySku: Map<string, number>
}

type TinyReceivableListItem = {
  id?: number
  idVenda?: number
  idNota?: number
  venda?: {
    id?: number
  }
  nota?: {
    id?: number
  }
  numeroDocumento?: string
  serieDocumento?: string
  formaRecebimento?: {
    nome?: string
  }
  meioPagamento?: {
    nome?: string
  }
  formaPagamento?: {
    nome?: string
  }
}

type TinyReceivableDetail = TinyReceivableListItem

// Conta a receber como vem na listagem, com os campos usados pela conciliação
// MP→Olist. O vínculo com o pedido do ML é o "OC nº {numeroPedidoEcommerce}"
// no historico (o filtro idVenda não retorna as contas geradas pela integração
// do Mercado Livre — validado ao vivo na conta real).
export type TinyReceivable = {
  id?: number
  situacao?: "aberto" | "cancelada" | "pago" | "parcial" | "prevista" | "atrasadas" | "emissao" | string
  data?: string
  dataVencimento?: string
  historico?: string
  valor?: number
  saldo?: number
  numeroDocumento?: string
  serieDocumento?: string
}

export function getBaseUrl(request: Request) {
  const configured = process.env.OLIST_REDIRECT_BASE_URL
  if (configured) return configured.replace(/\/$/, "")
  return new URL(request.url).origin
}

export function getRedirectUri(request: Request) {
  return `${getBaseUrl(request)}/callback`
}

export function getOAuthCredentials() {
  const clientId = process.env.OLIST_CLIENT_ID
  const clientSecret = process.env.OLIST_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error("OLIST_CLIENT_ID e OLIST_CLIENT_SECRET precisam estar configurados.")
  }

  return { clientId, clientSecret }
}

export function buildAuthorizationUrl(request: Request, state: string) {
  const { clientId } = getOAuthCredentials()
  const url = new URL(OLIST_AUTH_URL)
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("redirect_uri", getRedirectUri(request))
  url.searchParams.set("scope", "openid")
  url.searchParams.set("response_type", "code")
  url.searchParams.set("state", state)
  return url
}

export async function exchangeCodeForToken(request: Request, code: string) {
  const { clientId, clientSecret } = getOAuthCredentials()
  return tokenRequest({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: getRedirectUri(request),
    code,
  })
}

export async function refreshAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = getOAuthCredentials()
  return tokenRequest({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  })
}

async function tokenRequest(params: Record<string, string>) {
  const response = await fetch(OLIST_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    cache: "no-store",
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Falha ao obter token da Olist ERP API v3 (${response.status}): ${body}`)
  }

  return (await response.json()) as TinyTokenResponse
}

type CacheEntry<T> = { value: T; expiresAt: number }

// ---------------------------------------------------------------------------
// Sync para o banco: carrega pedidos de uma janela de datas, com detalhe completo.
// (O dashboard não chama mais a Olist no page load — só o job de sync, em background.)
// ---------------------------------------------------------------------------

export type SyncOrder = {
  pedido: Pedido
  situacao?: number
  detailLevel: "full" | "summary"
  raw: TinyOrderDetail
  itens: SyncOrderItem[]
}

export type SyncBatchHandler = (orders: SyncOrder[]) => Promise<unknown>

// Processa uma janela de datas de forma INCREMENTAL e resumível: busca a lista e, para
// cada pedido, o detalhe, montando lotes gravados via `onBatch`. Ao atingir `deadline`,
// para (completed=false) — o que já foi gravado em lote persiste, então a próxima
// execução continua. `skip` pula pedidos já sincronizados (backfill não refaz trabalho).
// Não busca contas-receber (a forma de pagamento vem do próprio detalhe do pedido).
export async function syncOrdersIncremental(
  accessToken: string,
  opts: {
    dataInicial: string
    dataFinal: string
    deadline: number
    maxItems?: number
    batchSize?: number
    skip?: (olistId: string) => boolean
    onBatch: SyncBatchHandler
  },
): Promise<{ processed: number; listed: number; completed: boolean }> {
  const maxItems = opts.maxItems ?? 5000
  const batchSize = opts.batchSize ?? 25
  const items = await fetchOrderListRange(accessToken, opts.dataInicial, opts.dataFinal, maxItems)
  const notaValues =
    items.length === 0
      ? new Map<number, number>()
      : await fetchNotaValuesRangeSafe(accessToken, opts.dataInicial, opts.dataFinal, maxItems)

  let processed = 0
  let completed = true
  let batch: TinyOrderDetail[] = []

  const flush = async () => {
    if (!batch.length) return
    const productCosts = await fetchProductCosts(accessToken, batch)
    const noPayments = new Map<string, string>()
    const custoDe = (id?: number, sku?: string) =>
      (id !== undefined ? productCosts.byId.get(id) : undefined) ??
      (sku ? productCosts.bySku.get(sku) : undefined) ??
      0
    const mapped: SyncOrder[] = batch.map((detail) => ({
      pedido: mapOrderToPedido(detail, productCosts, noPayments, notaValues),
      situacao: detail.situacao,
      detailLevel: "full",
      raw: detail,
      itens: extractOrderItems(detail, custoDe),
    }))
    await opts.onBatch(mapped)
    processed += mapped.length
    batch = []
  }

  for (const item of items) {
    if (!item.id) continue
    if (opts.skip?.(String(item.id))) continue
    if (Date.now() >= opts.deadline) {
      completed = false
      break
    }
    let detail: TinyOrderDetail
    try {
      detail = mergeOrderListItemWithDetail(
        item,
        await tinyFetch<TinyOrderDetail>(accessToken, `/pedidos/${item.id}`),
      )
    } catch {
      detail = itemToMinimalDetail(item)
    }
    batch.push(detail)
    if (batch.length >= batchSize) await flush()
  }
  await flush()

  return { processed, listed: items.length, completed }
}

// Recalcula custo e quantidade a partir de detalhes de pedido JÁ salvos (coluna `raw`),
// sem rebuscar os pedidos na Olist — só os custos de produto (cache-first; busca na Olist
// apenas os que faltam). Usado pelo job de recálculo para corrigir custos antigos zerados.
export async function recomputeCostsForRaws(
  accessToken: string,
  raws: unknown[],
): Promise<Array<{ custoTotal: number; quantidade: number }>> {
  const details = raws as TinyOrderDetail[]
  const productCosts = await fetchProductCosts(accessToken, details)
  const noPayments = new Map<string, string>()
  const noNotaValues = new Map<number, number>()
  return details.map((detail) => {
    const pedido = mapOrderToPedido(detail, productCosts, noPayments, noNotaValues)
    return { custoTotal: pedido.custoTotal, quantidade: pedido.quantidade }
  })
}

// Ponte entre o cache de custo em memória e a tabela product_costs (persiste entre
// cold starts do serverless): o sync semeia antes de rodar e exporta os custos depois.
export function primeProductCostCache(entries: Array<{ ref: string; custo: number }>) {
  const expiresAt = Date.now() + PRODUCT_COST_TTL_MS
  for (const { ref, custo } of entries) {
    if (ref.startsWith("id:")) productCostById.set(Number(ref.slice(3)), { value: custo, expiresAt })
    else if (ref.startsWith("sku:")) productCostBySku.set(ref.slice(4), { value: custo, expiresAt })
  }
}

export function exportProductCostCache(): Array<{ ref: string; custo: number }> {
  const out: Array<{ ref: string; custo: number }> = []
  for (const [id, entry] of productCostById) out.push({ ref: `id:${id}`, custo: entry.value })
  for (const [sku, entry] of productCostBySku) out.push({ ref: `sku:${sku}`, custo: entry.value })
  return out
}

async function fetchOrderListRange(
  accessToken: string,
  dataInicial: string,
  dataFinal: string,
  maxItems: number,
): Promise<TinyOrderListItem[]> {
  const items: TinyOrderListItem[] = []
  const limit = 100
  let offset = 0
  let total = Number.POSITIVE_INFINITY

  while (offset < total && items.length < maxItems) {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      orderBy: "desc",
      dataInicial,
      dataFinal,
    })
    let list: TinyListResponse<TinyOrderListItem>
    try {
      list = await tinyFetch<TinyListResponse<TinyOrderListItem>>(
        accessToken,
        `/pedidos?${params.toString()}`,
      )
    } catch (err) {
      if (err instanceof TinyApiError && err.status === 429 && items.length > 0) break
      throw err
    }
    const pageItems = list.itens ?? []
    items.push(...pageItems)
    total = list.paginacao?.total ?? items.length
    if (pageItems.length < limit) break
    offset += limit
  }

  return items.slice(0, maxItems)
}

// Busca o valor das notas fiscais criadas numa janela de datas e devolve id-da-nota → valor.
// Paginação no mesmo molde de fetchOrderListRange. Não lança em 429 se já houver dados.
export async function fetchNotaValuesRange(
  accessToken: string,
  dataInicial: string,
  dataFinal: string,
  maxItems: number,
): Promise<Map<number, number>> {
  const notas: TinyNotaListItem[] = []
  const limit = 100
  let offset = 0
  let total = Number.POSITIVE_INFINITY

  while (offset < total && notas.length < maxItems) {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      orderBy: "desc",
      // Confirmado no swagger público da v3 (erp.tiny.com.br/public-api/v3/swagger/swagger.json):
      // os parâmetros do /notas são dataInicial/dataFinal (busca por data de criação), não
      // dataInicialEmissao/dataFinalEmissao.
      dataInicial,
      dataFinal,
    })
    let list: TinyListResponse<TinyNotaListItem>
    try {
      list = await tinyFetch<TinyListResponse<TinyNotaListItem>>(accessToken, `/notas?${params.toString()}`)
    } catch (err) {
      if (err instanceof TinyApiError && err.status === 429 && notas.length > 0) break
      throw err
    }
    const pageItems = list.itens ?? []
    notas.push(...pageItems)
    total = list.paginacao?.total ?? notas.length
    if (pageItems.length < limit) break
    offset += limit
  }

  return indexNotaValues(notas.slice(0, maxItems))
}

// Wrapper não-fatal para o sync principal: mesmo com o schema do /notas confirmado
// contra o swagger público, uma conta real pode falhar por permissão, rate limit ou
// rede — isso aqui NÃO pode derrubar o sync de pedidos. O valor da NF fica ausente
// nesta execução e é recuperável depois via o backfill (que tem seu próprio
// tratamento de erro independente).
async function fetchNotaValuesRangeSafe(
  accessToken: string,
  dataInicial: string,
  dataFinal: string,
  maxItems: number,
): Promise<Map<number, number>> {
  try {
    return await fetchNotaValuesRange(accessToken, dataInicial, dataFinal, maxItems)
  } catch (err) {
    console.warn(
      "[olist-v3] fetchNotaValuesRange falhou; sync de pedidos continua sem valorNota nesta execução:",
      err,
    )
    return new Map<number, number>()
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// --- Controle de taxa (o limite da Olist é por conta: 60/120/240 req/min conforme o plano) ---
const RATE_LIMIT_PER_MIN = Number(process.env.OLIST_RATE_LIMIT_PER_MIN) || 120
const MIN_REQUEST_INTERVAL_MS =
  Number(process.env.OLIST_MIN_REQUEST_INTERVAL_MS) ||
  Math.ceil(60_000 / (RATE_LIMIT_PER_MIN * 0.85)) // ~15% de folga abaixo do limite
const MAX_RETRIES = Number(process.env.OLIST_MAX_RETRIES) || 5
const BACKOFF_BASE_MS = 1500
const BACKOFF_CAP_MS = 30_000

// Cascatas auxiliares caras (centenas de chamadas) ficam desligadas por padrão:
const FETCH_RECEIVABLE_DETAILS = process.env.OLIST_FETCH_RECEIVABLE_DETAILS === "true"
const DEEP_PRODUCT_COST = process.env.OLIST_DEEP_PRODUCT_COST === "true"
// Fallback de custo por SKU (rede de segurança contra custo 0). Ligado por padrão; é
// limitado (slice/cache) e bem mais barato que o deep cost histórico. Desligue com =false.
const PRODUCT_COST_SKU_FALLBACK = process.env.OLIST_PRODUCT_COST_SKU_FALLBACK !== "false"

// Portão serializado: garante um intervalo mínimo entre o INÍCIO de cada requisição,
// independentemente da concorrência das etapas. Todas as chamadas à API passam por aqui,
// então a taxa real de saída fica limitada pelo gate, não pelo `concurrency` das etapas.
let rateGate: Promise<void> = Promise.resolve()
let lastRequestStart = 0

function acquireRateSlot(): Promise<void> {
  rateGate = rateGate.then(async () => {
    const wait = MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestStart)
    if (wait > 0) await delay(wait)
    lastRequestStart = Date.now()
  })
  return rateGate
}

function getRetryDelayMs(response: Response, attempt: number): number {
  // Respeita o header Retry-After quando presente (segundos ou data HTTP).
  const retryAfter = response.headers.get("retry-after")
  if (retryAfter) {
    const secs = Number(retryAfter)
    if (Number.isFinite(secs)) return Math.min(secs * 1000, 60_000)
    const at = Date.parse(retryAfter)
    if (Number.isFinite(at)) return Math.min(Math.max(0, at - Date.now()), 60_000)
  }
  // Caso contrário, backoff exponencial com jitter.
  const exp = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1))
  return exp + Math.random() * 0.3 * exp
}

async function tinyFetch<T>(
  accessToken: string,
  path: string,
  init?: { method?: string; body?: unknown },
  maxRetries = MAX_RETRIES,
): Promise<T> {
  let attempt = 0
  const isMutation = init?.method && init.method !== "GET"
  while (true) {
    attempt++
    await acquireRateSlot()
    const response = await fetch(`${OLIST_API_URL}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    })

    if (!response.ok) {
      // Mutações NUNCA são reexecutadas — nem em 429 (revisão 22/08): o gateway
      // pode ter aplicado a escrita antes de responder, e repetir duplicaria o
      // recebimento/lançamento no ERP. Leituras seguem com retry em 429/5xx.
      const retryable = !isMutation && (response.status === 429 || response.status >= 500)
      if (retryable && attempt < maxRetries) {
        await delay(getRetryDelayMs(response, attempt))
        continue
      }
      const body = await response.text()
      throw new TinyApiError(`Olist ERP API v3 ${path} retornou ${response.status}: ${body}`, response.status)
    }

    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }
}

function itemToMinimalDetail(item: TinyOrderListItem): TinyOrderDetail {
  return {
    ...item,
    data: normalizeDate(item.dataCriacao),
    valorTotalPedido: toNumber(item.valor),
    itens: [
      {
        produto: {
          sku: item.ecommerce?.numeroPedidoEcommerce ?? String(item.numeroPedido ?? item.id ?? ""),
          descricao: `Pedido ${item.numeroPedido ?? item.id ?? ""}`,
        },
        quantidade: 1,
        valorUnitario: toNumber(item.valor),
      },
    ],
  }
}

function mergeOrderListItemWithDetail(
  item: TinyOrderListItem,
  detail: TinyOrderDetail,
): TinyOrderDetail {
  return {
    ...item,
    ...detail,
    ecommerce: detail.ecommerce ?? item.ecommerce,
    vendedor: detail.vendedor ?? item.vendedor,
    transportador: detail.transportador ?? item.transportador,
    dataCriacao: detail.dataCriacao ?? item.dataCriacao,
    valor: detail.valor ?? item.valor,
    situacao: detail.situacao ?? item.situacao,
  }
}

function mapOrderToPedido(
  order: TinyOrderDetail,
  productCosts: ProductCostLookup,
  receivablePayments: Map<string, string>,
  notaValues: Map<number, number>,
): Pedido {
  const itens = order.itens?.length ? order.itens : itemToMinimalDetail(order).itens ?? []
  const totalItens = itens.reduce(
    (sum, item) => sum + toNumber(item.valorUnitario) * Math.max(1, toNumber(item.quantidade)),
    0,
  )
  const primeiroItem = itens[0]
  const pedidoId = String(order.id ?? order.numeroPedido ?? crypto.randomUUID())
  const valorVenda = getValorVenda(order, totalItens)
  const custoTotal = itens.reduce((sum, item) => {
    const produtoId = item.produto?.id
    const sku = normalizeSku(item.produto?.sku)
    const custoMedio =
      (produtoId ? productCosts.byId.get(produtoId) : undefined) ??
      (sku ? productCosts.bySku.get(sku) : undefined) ??
      0
    return sum + custoMedio * Math.max(1, toNumber(item.quantidade))
  }, 0)
  const devolucao = order.situacao === 2 ? valorVenda : 0
  const quantidade = itens.reduce((sum, item) => sum + Math.max(1, toNumber(item.quantidade)), 0)
  const sufixoProduto = itens.length > 1 ? ` + ${itens.length - 1} item(ns)` : ""

  return {
    id: pedidoId,
    numeroPedido: String(order.numeroPedido ?? order.id ?? ""),
    numeroNF: order.idNotaFiscal ? String(order.idNotaFiscal) : "-",
    sku: primeiroItem?.produto?.sku || String(primeiroItem?.produto?.id ?? "sem-sku"),
    produto: `${primeiroItem?.produto?.descricao || "Pedido sem item"}${sufixoProduto}`,
    canal: getCanal(order),
    vendedor: order.vendedor?.nome || "Sem vendedor",
    formaPagamento: getFormaPagamento(order, receivablePayments),
    valorVenda: roundMoney(valorVenda),
    valorFrete: roundMoney(toNumber(order.valorFrete)),
    devolucao: roundMoney(devolucao),
    // Tarifa/comissão real quando a Olist a traz no pedido; senão 0 (o cálculo da M.C.
    // aplica a estimativa por canal em tempo de leitura — ver taxaComissaoEfetiva).
    taxaComissao: roundMoney(getOlistFee(order)),
    custoTotal: roundMoney(custoTotal),
    valorNota:
      order.idNotaFiscal != null && notaValues.has(order.idNotaFiscal)
        ? roundMoney(notaValues.get(order.idNotaFiscal)!)
        : undefined,
    quantidade: Math.max(1, quantidade),
    statusPagamento: getStatusPagamento(order),
    data: normalizeDate(order.data ?? order.dataCriacao ?? order.dataFaturamento),
  }
}

// Valor real da tarifa/comissão do marketplace, quando presente no detalhe do pedido.
// ⚠️ O campo só vem preenchido se a integração do canal estiver com "importar tarifas
// como despesa" ligada; o valor exato costuma chegar no Repasse (mês seguinte). Confirme
// o caminho inspecionando uma amostra real de `orders.raw`. Retorna 0 quando ausente.
function getOlistFee(order: TinyOrderDetail): number {
  return toNumber(order.valorOutrasDespesas)
}

// Custos de produto mudam raramente: cacheia por id e por sku atravessando
// carregamentos e períodos, removendo o maior bloco de chamadas em cargas "quentes".
// Só valores obtidos com sucesso são gravados (falhas não são cacheadas).
const PRODUCT_COST_TTL_MS = Number(process.env.OLIST_PRODUCT_COST_TTL_MS) || 6 * 60 * 60_000
const productCostById = new Map<number, CacheEntry<number>>()
const productCostBySku = new Map<string, CacheEntry<number>>()

function readCostCache<K>(map: Map<K, CacheEntry<number>>, key: K): number | undefined {
  const hit = map.get(key)
  if (hit && hit.expiresAt > Date.now()) return hit.value
  if (hit) map.delete(key)
  return undefined
}

function writeCostCache<K>(map: Map<K, CacheEntry<number>>, key: K, value: number): void {
  map.set(key, { value, expiresAt: Date.now() + PRODUCT_COST_TTL_MS })
}

async function fetchProductCosts(
  accessToken: string,
  orders: TinyOrderDetail[],
): Promise<ProductCostLookup> {
  const refs = collectProductRefs(orders)
  const lookup: ProductCostLookup = { byId: new Map(), bySku: new Map() }

  const idsToFetch = refs.ids.filter((id) => {
    const cached = readCostCache(productCostById, id)
    if (cached === undefined) return true
    lookup.byId.set(id, cached)
    return false
  })

  await mapWithConcurrency(idsToFetch.slice(0, 120), 3, async (id) => {
    try {
      const product = await tinyFetch<TinyProductDetail>(accessToken, `/produtos/${id}`)
      setProductCost(lookup, { id, sku: product.sku, cost: getProductCost(product) })

      if (DEEP_PRODUCT_COST && !lookup.byId.get(id)) {
        const history = await tinyFetch<TinyProductCostList>(accessToken, `/produtos/${id}/custos?limit=1`)
        setProductCost(lookup, { id, sku: product.sku, cost: getProductCostFromHistory(history) })
      }
      writeCostCache(productCostById, id, lookup.byId.get(id) ?? 0)
    } catch {
      lookup.byId.set(id, 0)
    }
  })

  // Busca por SKU (fallback) — ligada por padrão como rede de segurança contra custo 0.
  if (!PRODUCT_COST_SKU_FALLBACK) return lookup

  const missingSkus = refs.skus.filter((sku) => {
    if (lookup.bySku.has(sku)) return false
    const cached = readCostCache(productCostBySku, sku)
    if (cached === undefined) return true
    lookup.bySku.set(sku, cached)
    return false
  })

  await mapWithConcurrency(missingSkus.slice(0, 120), 3, async (sku) => {
    try {
      const params = new URLSearchParams({ codigo: sku, limit: "1", situacao: "A" })
      const list = await tinyFetch<TinyListResponse<TinyProductListItem>>(
        accessToken,
        `/produtos?${params.toString()}`,
      )
      const product = list.itens?.[0]
      setProductCost(lookup, { id: product?.id, sku, cost: getProductCost(product) })
      writeCostCache(productCostBySku, sku, lookup.bySku.get(sku) ?? 0)
    } catch {
      lookup.bySku.set(sku, 0)
    }
  })

  return lookup
}

function collectProductRefs(orders: TinyOrderDetail[]) {
  const ids = new Set<number>()
  const skus = new Set<string>()

  for (const order of orders) {
    for (const item of order.itens ?? []) {
      const id = item.produto?.id
      const sku = normalizeSku(item.produto?.sku)
      if (typeof id === "number") ids.add(id)
      if (sku) skus.add(sku)
    }
  }

  return { ids: Array.from(ids), skus: Array.from(skus) }
}

function setProductCost(
  lookup: ProductCostLookup,
  product: { id?: number; sku?: string; cost?: number },
) {
  const cost = product.cost ?? 0
  const sku = normalizeSku(product.sku)
  if (typeof product.id === "number") lookup.byId.set(product.id, cost)
  if (sku) lookup.bySku.set(sku, cost)
}

function getProductCost(product: TinyProductDetail | undefined) {
  return firstPositive(product?.precos?.precoCustoMedio, product?.precos?.precoCusto)
}

function getProductCostFromHistory(history: TinyProductCostList) {
  const latest = history.itens?.[0]
  return firstPositive(latest?.custoMedio, latest?.precoCusto)
}

async function fetchReceivablePayments(
  accessToken: string,
  orders: TinyOrderDetail[],
): Promise<Map<string, string>> {
  const payments = new Map<string, string>()
  const ordersMissingPayment = new Map<string, TinyOrderDetail>()

  for (const order of orders) {
    const key = getOrderPaymentKey(order)
    if (key && !getDirectPaymentName(order)) ordersMissingPayment.set(key, order)
  }

  if (!ordersMissingPayment.size) return payments

  // Lista de contas a receber (poucas chamadas) e preenche o que já vier nela.
  const receivables = await fetchRecentReceivables(accessToken)
  for (const receivable of receivables) {
    const order = findReceivableOrder(receivable, ordersMissingPayment)
    const payment = getReceivablePaymentName(receivable)
    if (order && payment) payments.set(getOrderPaymentKey(order), payment)
  }

  // As buscas de DETALHE (1 chamada por conta/por pedido, até centenas) ficam desligadas
  // por padrão p/ não estourar a taxa; reative com OLIST_FETCH_RECEIVABLE_DETAILS=true.
  if (!FETCH_RECEIVABLE_DETAILS) return payments

  const receivableCandidates = receivables.filter((receivable) => {
    const order = findReceivableOrder(receivable, ordersMissingPayment)
    return Boolean(order && !getReceivablePaymentName(receivable))
  })

  await mapWithConcurrency(receivableCandidates.slice(0, 200), 3, async (receivable) => {
    if (!receivable.id) return
    const order = findReceivableOrder(receivable, ordersMissingPayment)
    if (!order || payments.has(getOrderPaymentKey(order))) return

    try {
      const detail = await tinyFetch<TinyReceivableDetail>(accessToken, `/contas-receber/${receivable.id}`)
      const payment = getReceivablePaymentName(detail)
      if (payment) payments.set(getOrderPaymentKey(order), payment)
    } catch {
      // Keep the order payment as unknown when the financial record cannot be read.
    }
  })

  const remainingOrders = Array.from(ordersMissingPayment.values()).filter(
    (order) => !payments.has(getOrderPaymentKey(order)),
  )
  await mapWithConcurrency(remainingOrders.slice(0, 250), 3, async (order) => {
    const payment = await fetchReceivablePaymentByOrder(accessToken, order)
    if (payment) payments.set(getOrderPaymentKey(order), payment)
  })

  return payments
}

async function fetchReceivablePaymentByOrder(accessToken: string, order: TinyOrderDetail) {
  if (!order.id) return undefined

  try {
    const params = new URLSearchParams({ idVenda: String(order.id), limit: "1" })
    const list = await tinyFetch<TinyListResponse<TinyReceivableListItem>>(
      accessToken,
      `/contas-receber?${params.toString()}`,
    )
    const receivable = list.itens?.[0]
    const listPayment = receivable ? getReceivablePaymentName(receivable) : undefined
    if (listPayment || !receivable?.id) return listPayment

    const detail = await tinyFetch<TinyReceivableDetail>(accessToken, `/contas-receber/${receivable.id}`)
    return getReceivablePaymentName(detail)
  } catch {
    return undefined
  }
}

async function fetchRecentReceivables(accessToken: string) {
  const { dataInicial, dataFinal } = getOrderDateRange("7d")
  const items: TinyReceivableListItem[] = []
  const limit = 100
  let offset = 0
  let total = Number.POSITIVE_INFINITY

  while (offset < total && items.length < 300) {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      orderBy: "desc",
      dataInicialEmissao: dataInicial,
      dataFinalEmissao: dataFinal,
    })
    let list: TinyListResponse<TinyReceivableListItem>
    try {
      list = await tinyFetch<TinyListResponse<TinyReceivableListItem>>(
        accessToken,
        `/contas-receber?${params.toString()}`,
      )
    } catch (err) {
      if (err instanceof TinyApiError && err.status === 429 && items.length > 0) break
      throw err
    }
    const pageItems = list.itens ?? []
    items.push(...pageItems)
    total = list.paginacao?.total ?? items.length
    if (pageItems.length < limit) break
    offset += limit
  }

  return items.slice(0, 300)
}

// ---------------------------------------------------------------------------
// Conciliação MP→Olist: busca de contas a receber por janela de emissão e baixa.
// ---------------------------------------------------------------------------

// Lista contas a receber emitidas na janela (todas as situações — quem decide o
// que fazer com "pago"/"aberto" é o chamador). Paginação no molde das demais,
// MAS sem tolerar resultado parcial: a conciliação usa a AUSÊNCIA de conta como
// veredito (receivable_not_found), então um índice truncado por 429 geraria
// falso negativo em massa. Rate limit persistente após os retries = erro.
export async function fetchReceivablesByEmissionRange(
  accessToken: string,
  dataInicialEmissao: string,
  dataFinalEmissao: string,
  maxItems = 5000,
): Promise<TinyReceivable[]> {
  const items: TinyReceivable[] = []
  const limit = 100
  let offset = 0
  let total = Number.POSITIVE_INFINITY

  while (offset < total && items.length < maxItems) {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      orderBy: "desc",
      dataInicialEmissao,
      dataFinalEmissao,
    })
    const list = await tinyFetch<TinyListResponse<TinyReceivable>>(
      accessToken,
      `/contas-receber?${params.toString()}`,
    )
    const pageItems = list.itens ?? []
    items.push(...pageItems)
    total = list.paginacao?.total ?? items.length
    if (pageItems.length < limit) break
    offset += limit
  }

  if (items.length < Math.min(total, maxItems)) {
    throw new TinyApiError(
      `Listagem de contas a receber incompleta (${items.length} de ${total}); abortando para não gerar falso receivable_not_found.`,
      429,
    )
  }
  return items.slice(0, maxItems)
}

// Extrai o número do pedido do e-commerce ("OC nº 2000014421256617") do
// historico da conta a receber. Aceita "nº", "no", "n°" e afins.
export function extractOcNumber(historico: string | undefined): string | undefined {
  if (!historico) return undefined
  const match = historico.match(/OC\s*n[ºo°.]*\s*(\d{6,})/i)
  return match?.[1]
}

// Situações que ainda têm saldo a receber e podem ser baixadas.
export function isReceivableOpen(receivable: TinyReceivable): boolean {
  return ["aberto", "parcial", "prevista", "atrasadas"].includes(receivable.situacao ?? "")
}

export type BaixaContaReceber = {
  valorPago: number
  data: Date
  historico?: string
  // Payload validado em produção (22/08/2026, conta 362259083): valorPago=líquido
  // + taxa=tarifa QUITAM o título pelo bruto e a taxa alimenta "Taxas e tarifas"
  // na DRE. contaDestino direciona a conta financeira (sem ele o dinheiro cai na
  // conta padrão); categoria preserva a classificação do recebimento — sem ela
  // (ou com outra) o recebimento INTEIRO é reclassificado.
  taxa?: number
  contaDestino?: { id: number }
  categoria?: { id: number }
}

// O swagger da v3 documenta o campo `data` do POST /baixar como dd/mm/yyyy
// (diferente das listagens, que usam yyyy-mm-dd). Dia contábil de Fortaleza.
export function buildBaixaBody(baixa: BaixaContaReceber) {
  return {
    data: formatDateBr(baixa.data),
    valorPago: Math.round(baixa.valorPago * 100) / 100,
    ...(baixa.taxa !== undefined
      ? { taxa: Math.round(baixa.taxa * 100) / 100, juros: 0, desconto: 0, acrescimo: 0 }
      : {}),
    ...(baixa.contaDestino ? { contaDestino: baixa.contaDestino } : {}),
    ...(baixa.categoria ? { categoria: baixa.categoria } : {}),
    ...(baixa.historico ? { historico: baixa.historico } : {}),
  }
}

export function formatDateBr(date: Date, timeZone = "America/Fortaleza"): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit", year: "numeric" }).format(date)
}

// Dá baixa (liquida) uma conta a receber. 204 = sucesso. NÃO faz retry em 5xx
// (ver tinyFetch): baixar duas vezes duplicaria o recebimento no ERP.
export async function baixarContaReceber(
  accessToken: string,
  idContaReceber: number,
  baixa: BaixaContaReceber,
): Promise<void> {
  await tinyFetch<void>(accessToken, `/contas-receber/${idContaReceber}/baixar`, {
    method: "POST",
    body: buildBaixaBody(baixa),
  })
}

// Situações de NF que comprovam autorização na SEFAZ (doc v3): 6 = Autorizada,
// 7 = Emitida DANFE. Pendente/emitida/cancelada/rejeitada/denegada ficam fora.
export const NOTA_SITUACOES_AUTORIZADAS = new Set([6, 7])

// Situação atual de uma nota fiscal (gate do lancar-contas p/ pedidos Full).
export async function fetchNotaSituacao(accessToken: string, idNota: number): Promise<number | null> {
  const nota = await tinyFetch<{ situacao?: number | string }>(accessToken, `/notas/${idNota}`)
  const situacao = Number(nota?.situacao)
  return Number.isFinite(situacao) ? situacao : null
}

// Gera as contas (a receber) de uma nota fiscal já autorizada. 204 = sucesso.
// Usado para pedidos Full, cuja integração ML→Olist não cria o financeiro
// (validado ao vivo: 8/8 receivable_not_found pós-jun/2026 eram fulfillment).
// Mutação: sem retry em 5xx; o chamador garante no máximo uma execução por
// pedido (mp_releases.contas_lancadas_at).
export async function lancarContasNota(accessToken: string, idNota: number): Promise<void> {
  await tinyFetch<void>(accessToken, `/notas/${idNota}/lancar-contas`, { method: "POST" })
}

// Contas a receber vinculadas a uma nota fiscal (filtro idNota da listagem).
// Vínculo mais forte que o "OC nº" do historico — as contas geradas por
// lancar-contas podem nem carregar o OC no texto.
export async function fetchReceivablesByNota(
  accessToken: string,
  idNota: number,
): Promise<TinyReceivable[]> {
  const params = new URLSearchParams({ idNota: String(idNota), limit: "100" })
  const list = await tinyFetch<TinyListResponse<TinyReceivable>>(
    accessToken,
    `/contas-receber?${params.toString()}`,
  )
  return list.itens ?? []
}

function findReceivableOrder(
  receivable: TinyReceivableListItem,
  orders: Map<string, TinyOrderDetail>,
) {
  const vendaId = receivable.idVenda ?? receivable.venda?.id
  if (typeof vendaId === "number") {
    const byVenda = orders.get(String(vendaId))
    if (byVenda) return byVenda
  }

  const notaId = receivable.idNota ?? receivable.nota?.id
  if (typeof notaId === "number") {
    const byNota = Array.from(orders.values()).find((order) => order.idNotaFiscal === notaId)
    if (byNota) return byNota
  }

  const documentNumber = normalizeDocumentNumber(
    `${receivable.serieDocumento ?? ""}${receivable.numeroDocumento ?? ""}`,
  )
  if (!documentNumber) return undefined

  return Array.from(orders.values()).find((order) => normalizeDocumentNumber(String(order.idNotaFiscal ?? "")) === documentNumber)
}

function getValorVenda(order: TinyOrderDetail, totalItens: number) {
  return toNumber(order.valorTotalProdutos) || totalItens || toNumber(order.valorTotalPedido) || toNumber(order.valor)
}

function getCanal(order: TinyOrderDetail) {
  return (
    order.ecommerce?.canalVenda ||
    order.ecommerce?.nome ||
    order.intermediador?.nome ||
    "Olist ERP"
  )
}

function getFormaPagamento(
  order: TinyOrderDetail,
  receivablePayments: Map<string, string>,
): FormaPagamento {
  return (
    getDirectPaymentName(order) ||
    receivablePayments.get(getOrderPaymentKey(order)) ||
    "Não informado"
  ) as FormaPagamento
}

function getDirectPaymentName(order: TinyOrderDetail) {
  return firstText(
    order.pagamento?.meioPagamento?.nome,
    order.pagamento?.formaPagamento?.nome,
    order.pagamento?.formaRecebimento?.nome,
    ...((order.pagamento?.parcelas ?? []).flatMap((parcela) => [
      parcela.meioPagamento?.nome,
      parcela.formaPagamento?.nome,
      parcela.formaRecebimento?.nome,
    ])),
    ...((order.pagamentosIntegrados ?? []).flatMap((pagamento) => [
      pagamento.meioPagamento?.nome,
      pagamento.formaPagamento?.nome,
      pagamento.formaRecebimento?.nome,
      getIntegratedPaymentName(pagamento.tipoPagamento),
    ])),
  )
}

function getReceivablePaymentName(receivable: TinyReceivableListItem) {
  return firstText(
    receivable.meioPagamento?.nome,
    receivable.formaPagamento?.nome,
    receivable.formaRecebimento?.nome,
  )
}

function getIntegratedPaymentName(type: number | undefined) {
  if (typeof type !== "number") return undefined

  const paymentTypes: Record<number, string> = {
    1: "Dinheiro",
    2: "Cheque",
    3: "Cartão de crédito",
    4: "Cartão de débito",
    5: "Crédito loja",
    10: "Vale alimentação",
    11: "Vale refeição",
    12: "Vale presente",
    13: "Vale combustível",
    15: "Boleto",
    16: "Depósito bancário",
    17: "Pix",
    18: "Transferência",
  }

  return paymentTypes[type]
}

function getStatusPagamento(order: TinyOrderDetail): StatusPagamento {
  if (order.situacao === 2) return "Estornado"
  if ([1, 3, 4, 5, 6, 7].includes(order.situacao ?? -1)) return "Pago"

  const totalParcelas = order.pagamento?.parcelas?.reduce((sum, parcela) => sum + toNumber(parcela.valor), 0) ?? 0
  const totalPedido = toNumber(order.valorTotalPedido)
  if (totalParcelas > 0 && totalPedido > 0 && totalParcelas < totalPedido) return "Parcial"

  return "Pendente"
}

function normalizeDate(value: string | undefined) {
  if (!value) return new Date().toISOString().slice(0, 10)
  return value.slice(0, 10)
}

export function toNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  if (typeof value !== "string") return 0
  const trimmed = value.trim()
  const normalized =
    trimmed.includes(",") && trimmed.includes(".")
      ? trimmed.replace(/\./g, "").replace(",", ".")
      : trimmed.replace(",", ".")
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function firstPositive(...values: Array<number | undefined>) {
  return values.find((value) => typeof value === "number" && Number.isFinite(value) && value > 0) ?? 0
}

function firstText(...values: Array<string | undefined>) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim()
}

function normalizeSku(value: string | undefined) {
  const normalized = value?.trim()
  if (!normalized || normalized === "sem-sku") return undefined
  return normalized
}

function normalizeDocumentNumber(value: string) {
  return value.replace(/\D/g, "")
}

function getOrderPaymentKey(order: TinyOrderDetail) {
  return String(order.id ?? order.numeroPedido ?? "")
}

export function normalizePeriod(period: string): OrderPeriod {
  if (period === "7d" || period === "15d" || period === "30d" || period === "tudo") return period
  return "7d"
}

export function getOrderDateRange(period: OrderPeriod) {
  const daysByPeriod: Record<OrderPeriod, number> = {
    "7d": 7,
    "15d": 15,
    "30d": 30,
    tudo: 30,
  }
  const maxItemsByPeriod: Record<OrderPeriod, number> = {
    "7d": 300,
    "15d": 400,
    "30d": 500,
    tudo: 500,
  }
  const final = new Date()
  const inicial = new Date(final)
  inicial.setDate(final.getDate() - daysByPeriod[period])

  return {
    dataInicial: formatDateParam(inicial),
    dataFinal: formatDateParam(final),
    maxItems: maxItemsByPeriod[period],
  }
}

function formatDateParam(date: Date) {
  return date.toISOString().slice(0, 10)
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
) {
  const results: R[] = []
  let cursor = 0

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await mapper(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}
