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
    parcelas?: Array<{
      valor?: number
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
}

type TinyProductDetail = {
  id?: number
  precos?: {
    precoCusto?: number
    precoCustoMedio?: number
  }
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

export async function fetchTinyOrders(accessToken: string): Promise<Pedido[]> {
  const items = await fetchRecentOrderList(accessToken)
  const details = await mapWithConcurrency(items, 8, async (item) => {
    if (!item.id) return null
    try {
      return await tinyFetch<TinyOrderDetail>(accessToken, `/pedidos/${item.id}`)
    } catch {
      return itemToMinimalDetail(item)
    }
  })

  const productIds = Array.from(
    new Set(
      details
        .flatMap((order) => order?.itens ?? [])
        .map((item) => item.produto?.id)
        .filter((id): id is number => typeof id === "number"),
    ),
  )

  const productCostMap = new Map<number, number>()
  await Promise.all(
    productIds.slice(0, 80).map(async (id) => {
      try {
        const product = await tinyFetch<TinyProductDetail>(accessToken, `/produtos/${id}`)
        productCostMap.set(id, product.precos?.precoCustoMedio ?? product.precos?.precoCusto ?? 0)
      } catch {
        productCostMap.set(id, 0)
      }
    }),
  )

  return details
    .filter((order): order is TinyOrderDetail => Boolean(order))
    .map((order) => mapOrderToPedido(order, productCostMap))
    .sort((a, b) => (a.data < b.data ? 1 : -1))
}

async function fetchRecentOrderList(accessToken: string) {
  const { dataInicial, dataFinal } = getDefaultOrderDateRange()
  const items: TinyOrderListItem[] = []
  const limit = 100
  let offset = 0
  let total = Number.POSITIVE_INFINITY

  while (offset < total && items.length < 1000) {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      orderBy: "desc",
      dataInicial,
      dataFinal,
    })
    const list = await tinyFetch<TinyListResponse<TinyOrderListItem>>(
      accessToken,
      `/pedidos?${params.toString()}`,
    )
    const pageItems = list.itens ?? []
    items.push(...pageItems)
    total = list.paginacao?.total ?? items.length
    if (pageItems.length < limit) break
    offset += limit
  }

  return items
}

async function tinyFetch<T>(accessToken: string, path: string): Promise<T> {
  const response = await fetch(`${OLIST_API_URL}${path}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Olist ERP API v3 ${path} retornou ${response.status}: ${body}`)
  }

  return (await response.json()) as T
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

function mapOrderToPedido(order: TinyOrderDetail, productCostMap: Map<number, number>): Pedido {
  const itens = order.itens?.length ? order.itens : itemToMinimalDetail(order).itens ?? []
  const totalItens = itens.reduce(
    (sum, item) => sum + toNumber(item.valorUnitario) * Math.max(1, toNumber(item.quantidade)),
    0,
  )
  const primeiroItem = itens[0]
  const pedidoId = String(order.id ?? order.numeroPedido ?? crypto.randomUUID())
  const valorVenda = toNumber(order.valorTotalPedido) || toNumber(order.valor) || totalItens
  const custoTotal = itens.reduce((sum, item) => {
    const produtoId = item.produto?.id
    const custoMedio = produtoId ? productCostMap.get(produtoId) ?? 0 : 0
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
    formaPagamento: getFormaPagamento(order),
    valorVenda: roundMoney(valorVenda),
    valorFrete: roundMoney(toNumber(order.valorFrete)),
    devolucao: roundMoney(devolucao),
    taxaComissao: 0,
    custoTotal: roundMoney(custoTotal),
    statusPagamento: getStatusPagamento(order),
    data: normalizeDate(order.data ?? order.dataCriacao ?? order.dataFaturamento),
  }
}

function getCanal(order: TinyOrderDetail) {
  return (
    order.ecommerce?.canalVenda ||
    order.ecommerce?.nome ||
    order.intermediador?.nome ||
    "Olist ERP"
  )
}

function getFormaPagamento(order: TinyOrderDetail): FormaPagamento {
  return (
    order.pagamento?.meioPagamento?.nome ||
    order.pagamento?.formaRecebimento?.nome ||
    "Não informado"
  ) as FormaPagamento
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

function getDefaultOrderDateRange() {
  const final = new Date()
  const inicial = new Date(final)
  inicial.setDate(final.getDate() - 30)

  return {
    dataInicial: formatDateParam(inicial),
    dataFinal: formatDateParam(final),
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
