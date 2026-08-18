// Cliente mínimo da API do Mercado Livre para custos reais por pedido.
// Token via client_credentials (a app da conta OEMPARTSOFICIAL já tem escopo de
// orders/shipments) — expira em ~6h; cache em módulo com folga de 60s.

const ML_API_URL = "https://api.mercadolibre.com"

let tokenCache: { token: string; expiresAt: number } | null = null

export function _resetTokenCache(): void {
  tokenCache = null
}

export async function getMlAccessToken(fetchFn: typeof fetch = fetch): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token

  const clientId = process.env.ML_CLIENT_ID
  const clientSecret = process.env.ML_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error("ML_CLIENT_ID e ML_CLIENT_SECRET precisam estar configurados.")
  }

  const response = await fetchFn(`${ML_API_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
    cache: "no-store",
  })
  if (!response.ok) {
    throw new Error(`Falha ao obter token do Mercado Livre (${response.status}): ${await response.text()}`)
  }
  const data = (await response.json()) as { access_token: string; expires_in?: number }
  tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 21600) * 1000 }
  return data.access_token
}

export type MlOrderCost = {
  mlOrderId: string
  saleFee: number
  shippingCost: number
  listingType: string | null
  mlStatus: string | null
  raw: unknown
}

export type MlOrder = {
  id?: number
  status?: string
  shipping?: { id?: number }
  order_items?: Array<{ quantity?: number; sale_fee?: number; listing_type_id?: string }>
  payments?: Array<{ id?: number; status?: string }>
}

type MlPack = {
  id?: number
  shipment?: { id?: number }
  orders?: Array<{ id?: number }>
}

type MlShipmentCosts = { senders?: Array<{ cost?: number }> }

// A Olist às vezes grava o pack_id (carrinho multi-pedido do ML) em vez do
// order_id em `ecommerce.numeroPedidoEcommerce` — comum quando o comprador
// fecha vários itens do mesmo vendedor num único checkout. Quando /orders/{id}
// dá 404, tentamos /packs/{id}: o pack agrega os order_ids reais e o shipment
// (frete é por pacote, não por pedido individual).
export type ResolvedMlOrders = { orders: MlOrder[]; packShipmentId?: number }

export async function resolveMlOrders(
  mlOrderId: string,
  accessToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<ResolvedMlOrders | null> {
  const headers = { Authorization: `Bearer ${accessToken}` }

  const orderRes = await fetchFn(`${ML_API_URL}/orders/${mlOrderId}`, { headers, cache: "no-store" })
  if (orderRes.ok) {
    const order = (await orderRes.json()) as MlOrder
    return { orders: [order] }
  }
  if (orderRes.status !== 404) {
    throw new Error(`ML /orders/${mlOrderId} retornou ${orderRes.status}: ${await orderRes.text()}`)
  }

  const packRes = await fetchFn(`${ML_API_URL}/packs/${mlOrderId}`, { headers, cache: "no-store" })
  if (packRes.status === 404) return null
  if (!packRes.ok) {
    throw new Error(`ML /packs/${mlOrderId} retornou ${packRes.status}: ${await packRes.text()}`)
  }
  const pack = (await packRes.json()) as MlPack
  const orderIds = (pack.orders ?? []).map((o) => o.id).filter((id): id is number => typeof id === "number")
  if (!orderIds.length) return null

  const orders = await Promise.all(
    orderIds.map(async (id) => {
      const res = await fetchFn(`${ML_API_URL}/orders/${id}`, { headers, cache: "no-store" })
      return res.ok ? ((await res.json()) as MlOrder) : null
    }),
  )
  const validOrders = orders.filter((o): o is MlOrder => o !== null)
  if (!validOrders.length) return null

  return { orders: validOrders, packShipmentId: pack.shipment?.id }
}

export async function fetchMlOrderCost(
  mlOrderId: string,
  accessToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<MlOrderCost | null> {
  const resolved = await resolveMlOrders(mlOrderId, accessToken, fetchFn)
  if (!resolved) return null
  const shippingId =
    resolved.orders.length === 1 && resolved.packShipmentId === undefined
      ? resolved.orders[0].shipping?.id
      : resolved.packShipmentId
  return buildCost(mlOrderId, resolved.orders, shippingId, { Authorization: `Bearer ${accessToken}` }, fetchFn)
}

async function buildCost(
  mlOrderId: string,
  orders: MlOrder[],
  shippingId: number | undefined,
  headers: Record<string, string>,
  fetchFn: typeof fetch,
): Promise<MlOrderCost> {
  const saleFee = orders.reduce(
    (sum, order) =>
      sum +
      (order.order_items ?? []).reduce((s, item) => s + (item.sale_fee ?? 0) * Math.max(1, item.quantity ?? 1), 0),
    0,
  )

  let shippingCost = 0
  if (shippingId) {
    const costsRes = await fetchFn(`${ML_API_URL}/shipments/${shippingId}/costs`, { headers, cache: "no-store" })
    if (costsRes.ok) {
      const costs = (await costsRes.json()) as MlShipmentCosts
      shippingCost = (costs.senders ?? []).reduce((sum, s) => sum + (s.cost ?? 0), 0)
    }
  }

  return {
    mlOrderId,
    saleFee: Math.round(saleFee * 100) / 100,
    shippingCost: Math.round(shippingCost * 100) / 100,
    listingType: orders[0]?.order_items?.[0]?.listing_type_id ?? null,
    mlStatus: orders[0]?.status ?? null,
    raw: orders.length === 1 ? orders[0] : orders,
  }
}
