import type { FormaPagamento, Pedido, StatusPagamento } from "@/lib/data"

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

type TinyOrderDetail = TinyOrderListItem & {
  idNotaFiscal?: number
  data?: string
  dataFaturamento?: string
  valorTotalProdutos?: number
  valorTotalPedido?: number
  valorFrete?: number
  valorDesconto?: number
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

export async function fetchTinyOrders(accessToken: string, period: string = "7d"): Promise<Pedido[]> {
  const items = await fetchRecentOrderList(accessToken, normalizePeriod(period))
  const details = await mapWithConcurrency(items, 3, async (item) => {
    if (!item.id) return null
    try {
      const detail = await tinyFetch<TinyOrderDetail>(accessToken, `/pedidos/${item.id}`)
      return mergeOrderListItemWithDetail(item, detail)
    } catch {
      return itemToMinimalDetail(item)
    }
  })

  const validDetails = details.filter((order): order is TinyOrderDetail => Boolean(order))
  const productCosts = await fetchProductCosts(accessToken, validDetails)
  const receivablePayments = await fetchReceivablePayments(accessToken, validDetails)

  return validDetails
    .map((order) => mapOrderToPedido(order, productCosts, receivablePayments))
    .sort((a, b) => (a.data < b.data ? 1 : -1))
}

async function fetchRecentOrderList(accessToken: string, period: OrderPeriod) {
  const { dataInicial, dataFinal, maxItems } = getOrderDateRange(period)
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

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function tinyFetch<T>(accessToken: string, path: string, maxRetries = 3): Promise<T> {
  let attempt = 0
  while (true) {
    attempt++
    const response = await fetch(`${OLIST_API_URL}${path}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    })

    if (!response.ok) {
      if (response.status === 429 && attempt < maxRetries) {
        await delay(attempt * 2000) // Backoff de 2s, 4s, etc.
        continue
      }
      const body = await response.text()
      throw new TinyApiError(`Olist ERP API v3 ${path} retornou ${response.status}: ${body}`, response.status)
    }

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
    taxaComissao: 0,
    custoTotal: roundMoney(custoTotal),
    statusPagamento: getStatusPagamento(order),
    data: normalizeDate(order.data ?? order.dataCriacao ?? order.dataFaturamento),
  }
}

async function fetchProductCosts(
  accessToken: string,
  orders: TinyOrderDetail[],
): Promise<ProductCostLookup> {
  const refs = collectProductRefs(orders)
  const lookup: ProductCostLookup = { byId: new Map(), bySku: new Map() }

  await mapWithConcurrency(refs.ids.slice(0, 120), 3, async (id) => {
    try {
      const product = await tinyFetch<TinyProductDetail>(accessToken, `/produtos/${id}`)
      setProductCost(lookup, { id, sku: product.sku, cost: getProductCost(product) })

      if (!lookup.byId.get(id)) {
        const history = await tinyFetch<TinyProductCostList>(accessToken, `/produtos/${id}/custos?limit=1`)
        setProductCost(lookup, { id, sku: product.sku, cost: getProductCostFromHistory(history) })
      }
    } catch {
      lookup.byId.set(id, 0)
    }
  })

  const missingSkus = refs.skus.filter((sku) => !lookup.bySku.has(sku))
  await mapWithConcurrency(missingSkus.slice(0, 120), 3, async (sku) => {
    try {
      const params = new URLSearchParams({ codigo: sku, limit: "1", situacao: "A" })
      const list = await tinyFetch<TinyListResponse<TinyProductListItem>>(
        accessToken,
        `/produtos?${params.toString()}`,
      )
      const product = list.itens?.[0]
      setProductCost(lookup, { id: product?.id, sku, cost: getProductCost(product) })
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

  const receivables = await fetchRecentReceivables(accessToken)
  const receivableCandidates = receivables.filter((receivable) => {
    const order = findReceivableOrder(receivable, ordersMissingPayment)
    return Boolean(order && !getReceivablePaymentName(receivable))
  })

  for (const receivable of receivables) {
    const order = findReceivableOrder(receivable, ordersMissingPayment)
    const payment = getReceivablePaymentName(receivable)
    if (order && payment) payments.set(getOrderPaymentKey(order), payment)
  }

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
    3: "CartÃ£o de crÃ©dito",
    4: "CartÃ£o de dÃ©bito",
    5: "CrÃ©dito loja",
    10: "Vale alimentaÃ§Ã£o",
    11: "Vale refeiÃ§Ã£o",
    12: "Vale presente",
    13: "Vale combustÃ­vel",
    15: "Boleto",
    16: "DepÃ³sito bancÃ¡rio",
    17: "Pix",
    18: "TransferÃªncia",
  }

  return paymentTypes[type]
}

function getStatusPagamento(order: TinyOrderDetail): StatusPagamento {
  if (order.situacao === 2) return "Estornado"
  if ([1, 5, 6].includes(order.situacao ?? -1)) return "Pago"

  const totalParcelas = order.pagamento?.parcelas?.reduce((sum, parcela) => sum + toNumber(parcela.valor), 0) ?? 0
  const totalPedido = toNumber(order.valorTotalPedido)
  if (totalParcelas > 0 && totalPedido > 0 && totalParcelas < totalPedido) return "Parcial"

  return "Pendente"
}

function normalizeDate(value: string | undefined) {
  if (!value) return new Date().toISOString().slice(0, 10)
  return value.slice(0, 10)
}

function toNumber(value: unknown) {
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

function normalizePeriod(period: string): OrderPeriod {
  if (period === "7d" || period === "15d" || period === "30d" || period === "tudo") return period
  return "7d"
}

function getOrderDateRange(period: OrderPeriod) {
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
