import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

beforeEach(() => {
  process.env.SHOPEE_PARTNER_ID = "1"
  process.env.SHOPEE_PARTNER_KEY = "abc"
  delete process.env.SHOPEE_API_HOST
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.resetModules()
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

describe("assinatura Shopee", () => {
  it("HMAC-SHA256 hex da base com a partner key", async () => {
    const { shopeeSign } = await import("@/lib/shopee-api")
    expect(shopeeSign("abc", "1/api/v2/shop/auth_partner1610000000")).toBe(
      "c182b8cd3c3ea1d52ccb1a213ff5dbc9388520f455fc2a13523bd0e829798bf0",
    )
  })

  it("URL de autorização leva partner_id, timestamp, sign e redirect", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(1_610_000_000_000))
    const { buildShopeeAuthUrl } = await import("@/lib/shopee-api")
    const url = new URL(buildShopeeAuthUrl("https://dash.test/api/shopee/auth/callback?state=x"))
    expect(url.origin + url.pathname).toBe("https://partner.shopeemobile.com/api/v2/shop/auth_partner")
    expect(url.searchParams.get("partner_id")).toBe("1")
    expect(url.searchParams.get("timestamp")).toBe("1610000000")
    expect(url.searchParams.get("sign")).toBe("c182b8cd3c3ea1d52ccb1a213ff5dbc9388520f455fc2a13523bd0e829798bf0")
    expect(url.searchParams.get("redirect")).toBe("https://dash.test/api/shopee/auth/callback?state=x")
  })

  it("chamada de loja assina com access_token e shop_id", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(1_610_000_000_000))
    const calls: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        calls.push(String(input))
        return json({ error: "", message: "", response: { order_sn: "X", order_income: { escrow_amount: 10 } } })
      }),
    )
    const { fetchEscrowDetail } = await import("@/lib/shopee-api")
    const detail = await fetchEscrowDetail({ accessToken: "tok", shopId: 600000 }, "X")
    expect(detail.order_income?.escrow_amount).toBe(10)
    const url = new URL(calls[0])
    expect(url.pathname).toBe("/api/v2/payment/get_escrow_detail")
    expect(url.searchParams.get("sign")).toBe("9d3ee1402f7cb9586f67c6e97453910c7890085dc3060c41af277309fe36cb65")
    expect(url.searchParams.get("shop_id")).toBe("600000")
    expect(url.searchParams.get("access_token")).toBe("tok")
    expect(url.searchParams.get("order_sn")).toBe("X")
  })

  it("erro no corpo vira ShopeeApiError, mesmo com HTTP 200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "error_auth", message: "Invalid access_token." })))
    const { fetchEscrowDetail, ShopeeApiError } = await import("@/lib/shopee-api")
    await expect(fetchEscrowDetail({ accessToken: "tok", shopId: 1 }, "X")).rejects.toBeInstanceOf(ShopeeApiError)
  })
})

describe("carteira Shopee", () => {
  it("pagina até more=false e quebra janelas maiores que 15 dias", async () => {
    const calls: URL[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input))
        calls.push(url)
        const page = Number(url.searchParams.get("page_no"))
        const from = url.searchParams.get("create_time_from")
        return json({
          error: "",
          response: {
            transaction_list: [{ transaction_type: "ESCROW_VERIFIED_ADD", status: "COMPLETED", amount: 1, create_time: Number(from) + page, order_sn: `${from}-${page}` }],
            more: page === 0,
          },
        })
      }),
    )
    const { fetchWalletTransactions } = await import("@/lib/shopee-api")
    const day = 86_400
    const txns = await fetchWalletTransactions({ accessToken: "t", shopId: 1 }, 0, 20 * day)

    const windows = [...new Set(calls.map((u) => `${u.searchParams.get("create_time_from")}-${u.searchParams.get("create_time_to")}`))]
    expect(windows).toEqual([`0-${15 * day}`, `${15 * day + 1}-${20 * day}`])
    expect(calls.every((u) => u.searchParams.get("page_size") === "100")).toBe(true)
    expect(txns).toHaveLength(4)
  })
})

describe("tokens Shopee", () => {
  it("troca o code e o refresh por POST com corpo numérico", async () => {
    const bodies: unknown[] = []
    const paths: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        paths.push(new URL(String(input)).pathname)
        bodies.push(JSON.parse(String(init?.body)))
        return json({ error: "", access_token: "a", refresh_token: "r", expire_in: 14400 })
      }),
    )
    const { exchangeShopeeCode, refreshShopeeToken } = await import("@/lib/shopee-api")
    await exchangeShopeeCode("CODE", 600000)
    const t = await refreshShopeeToken("OLD", 600000)
    expect(paths).toEqual(["/api/v2/auth/token/get", "/api/v2/auth/access_token/get"])
    expect(bodies).toEqual([
      { code: "CODE", shop_id: 600000, partner_id: 1 },
      { refresh_token: "OLD", shop_id: 600000, partner_id: 1 },
    ])
    expect(t).toMatchObject({ accessToken: "a", refreshToken: "r", expireIn: 14400 })
  })
})
