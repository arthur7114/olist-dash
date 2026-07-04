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

type MlOrder = {
  id?: number
  status?: string
  shipping?: { id?: number }
  order_items?: Array<{ quantity?: number; sale_fee?: number; listing_type_id?: string }>
}

type MlShipmentCosts = { senders?: Array<{ cost?: number }> }

export async function fetchMlOrderCost(
  mlOrderId: string,
  accessToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<MlOrderCost | null> {
  const headers = { Authorization: `Bearer ${accessToken}` }

  const orderRes = await fetchFn(`${ML_API_URL}/orders/${mlOrderId}`, { headers, cache: "no-store" })
  if (orderRes.status === 404) return null
  if (!orderRes.ok) {
    throw new Error(`ML /orders/${mlOrderId} retornou ${orderRes.status}: ${await orderRes.text()}`)
  }
  const order = (await orderRes.json()) as MlOrder

  const saleFee = (order.order_items ?? []).reduce(
    (sum, item) => sum + (item.sale_fee ?? 0) * Math.max(1, item.quantity ?? 1),
    0,
  )

  let shippingCost = 0
  const shippingId = order.shipping?.id
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
    listingType: order.order_items?.[0]?.listing_type_id ?? null,
    mlStatus: order.status ?? null,
    raw: order,
  }
}
