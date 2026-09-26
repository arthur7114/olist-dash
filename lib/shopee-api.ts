// Cliente da Shopee Open Platform v2 (só o que a conciliação usa). Formato conferido na
// doc oficial em 26/09/2026: assinatura HMAC-SHA256 hex com a partner key sobre
// partner_id+path+timestamp (+access_token+shop_id nas chamadas de loja). A Shopee
// responde 200 com `error` preenchido quando falha, então o erro vem do corpo.

import { createHmac } from "crypto"

const DEFAULT_HOST = "https://partner.shopeemobile.com"
const MAX_WINDOW_SEC = 15 * 86_400 // janela máxima da carteira
const PAGE_SIZE = 100

export class ShopeeApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(`Shopee ${code}: ${message}`)
  }
}

export type ShopeeAuth = { accessToken: string; shopId: number }

export type ShopeeToken = { accessToken: string; refreshToken: string; expireIn: number }

export type ShopeeWalletTxn = {
  status?: string // FAILED | COMPLETED | PENDING | INITIAL
  transaction_type?: string
  amount?: number
  current_balance?: number
  create_time?: number
  order_sn?: string
  refund_sn?: string
  withdrawal_type?: string
  transaction_fee?: number
  description?: string
  withdrawal_id?: number
  root_withdrawal_id?: number
  reason?: string
  money_flow?: string
}

export type ShopeeOrderIncome = {
  escrow_amount?: number
  escrow_amount_after_adjustment?: number
  buyer_total_amount?: number
  cost_of_goods_sold?: number
  commission_fee?: number
  service_fee?: number
  seller_transaction_fee?: number
  order_ams_commission_fee?: number
  seller_return_refund?: number
  drc_adjustable_refund?: number
  buyer_paid_shipping_fee?: number
  actual_shipping_fee?: number
  final_shipping_fee?: number
  shopee_shipping_rebate?: number
  total_adjustment_amount?: number
  [key: string]: unknown
}

export type ShopeeEscrowDetail = {
  order_sn?: string
  return_order_sn_list?: string[]
  order_income?: ShopeeOrderIncome
}

function config() {
  const partnerId = Number(process.env.SHOPEE_PARTNER_ID)
  const partnerKey = process.env.SHOPEE_PARTNER_KEY
  if (!partnerId || !partnerKey) throw new Error("SHOPEE_PARTNER_ID e SHOPEE_PARTNER_KEY precisam estar configurados.")
  return { partnerId, partnerKey, host: (process.env.SHOPEE_API_HOST || DEFAULT_HOST).replace(/\/$/, "") }
}

export function hasShopeeConfig(): boolean {
  return Boolean(Number(process.env.SHOPEE_PARTNER_ID) && process.env.SHOPEE_PARTNER_KEY)
}

export function shopeeSign(partnerKey: string, base: string): string {
  return createHmac("sha256", partnerKey).update(base).digest("hex")
}

const now = () => Math.floor(Date.now() / 1000)

function publicUrl(path: string): URL {
  const { partnerId, partnerKey, host } = config()
  const timestamp = now()
  const url = new URL(host + path)
  url.searchParams.set("partner_id", String(partnerId))
  url.searchParams.set("timestamp", String(timestamp))
  url.searchParams.set("sign", shopeeSign(partnerKey, `${partnerId}${path}${timestamp}`))
  return url
}

async function readBody<T>(response: Response): Promise<T> {
  const text = await response.text()
  let body: Record<string, unknown> = {}
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    throw new ShopeeApiError("invalid_json", text.slice(0, 200), response.status)
  }
  const error = typeof body.error === "string" ? body.error : ""
  if (error || !response.ok) {
    throw new ShopeeApiError(error || `http_${response.status}`, String(body.message ?? text.slice(0, 200)), response.status)
  }
  return body as T
}

export function buildShopeeAuthUrl(redirect: string): string {
  const url = publicUrl("/api/v2/shop/auth_partner")
  url.searchParams.set("redirect", redirect)
  return url.toString()
}

type TokenBody = { access_token?: string; refresh_token?: string; expire_in?: number }

function toToken(body: TokenBody): ShopeeToken {
  if (!body.access_token || !body.refresh_token) throw new ShopeeApiError("no_token", "resposta sem access_token/refresh_token")
  return { accessToken: body.access_token, refreshToken: body.refresh_token, expireIn: Number(body.expire_in) || 14_400 }
}

async function postPublic<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(publicUrl(path).toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, partner_id: config().partnerId }),
    cache: "no-store",
  })
  return readBody<T>(response)
}

export async function exchangeShopeeCode(code: string, shopId: number): Promise<ShopeeToken> {
  return toToken(await postPublic<TokenBody>("/api/v2/auth/token/get", { code, shop_id: shopId }))
}

// O refresh token é de uso único: quem chamar precisa gravar o novo antes de seguir.
export async function refreshShopeeToken(refreshToken: string, shopId: number): Promise<ShopeeToken> {
  return toToken(await postPublic<TokenBody>("/api/v2/auth/access_token/get", { refresh_token: refreshToken, shop_id: shopId }))
}

async function shopGet<T>(auth: ShopeeAuth, path: string, params: Record<string, string | number>): Promise<T> {
  const { partnerId, partnerKey, host } = config()
  const timestamp = now()
  const url = new URL(host + path)
  url.searchParams.set("partner_id", String(partnerId))
  url.searchParams.set("timestamp", String(timestamp))
  url.searchParams.set("access_token", auth.accessToken)
  url.searchParams.set("shop_id", String(auth.shopId))
  url.searchParams.set("sign", shopeeSign(partnerKey, `${partnerId}${path}${timestamp}${auth.accessToken}${auth.shopId}`))
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
  const response = await fetch(url.toString(), { cache: "no-store" })
  return readBody<T>(response)
}

export async function fetchEscrowDetail(auth: ShopeeAuth, orderSn: string): Promise<ShopeeEscrowDetail> {
  const body = await shopGet<{ response?: ShopeeEscrowDetail }>(auth, "/api/v2/payment/get_escrow_detail", { order_sn: orderSn })
  return body.response ?? {}
}

// Lançamentos da carteira entre dois instantes (segundos Unix), em janelas de 15 dias.
export async function fetchWalletTransactions(auth: ShopeeAuth, fromSec: number, toSec: number): Promise<ShopeeWalletTxn[]> {
  const out: ShopeeWalletTxn[] = []
  // Janelas sem sobreposição: [start, end], a próxima começa em end + 1.
  for (let start = fromSec; start <= toSec; start += MAX_WINDOW_SEC + 1) {
    const end = Math.min(start + MAX_WINDOW_SEC, toSec)
    for (let page = 0; ; page++) {
      const body = await shopGet<{ response?: { transaction_list?: ShopeeWalletTxn[]; more?: boolean } }>(
        auth,
        "/api/v2/payment/get_wallet_transaction_list",
        { page_no: page, page_size: PAGE_SIZE, create_time_from: start, create_time_to: end },
      )
      out.push(...(body.response?.transaction_list ?? []))
      if (!body.response?.more) break
    }
  }
  return out
}
