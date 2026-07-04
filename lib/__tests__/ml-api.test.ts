import { beforeEach, describe, expect, it, vi } from "vitest"
import { _resetTokenCache, fetchMlOrderCost, getMlAccessToken } from "@/lib/ml-api"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

beforeEach(() => {
  _resetTokenCache()
  process.env.ML_CLIENT_ID = "id"
  process.env.ML_CLIENT_SECRET = "secret"
})

describe("getMlAccessToken", () => {
  it("busca token e reusa do cache até expirar", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ access_token: "tok", expires_in: 21600 }))
    expect(await getMlAccessToken(fetchFn as unknown as typeof fetch)).toBe("tok")
    expect(await getMlAccessToken(fetchFn as unknown as typeof fetch)).toBe("tok")
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})

describe("fetchMlOrderCost", () => {
  it("soma sale_fee por quantidade e busca custo de frete do vendedor", async () => {
    const fetchFn = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("/orders/")) {
        return Promise.resolve(
          jsonResponse({
            id: 2000017243866816,
            status: "paid",
            shipping: { id: 47444074544 },
            order_items: [
              { quantity: 2, sale_fee: 13.63, listing_type_id: "gold_pro" },
              { quantity: 1, sale_fee: 5.0, listing_type_id: "gold_special" },
            ],
          }),
        )
      }
      return Promise.resolve(jsonResponse({ senders: [{ cost: 12.35 }] }))
    })
    const result = await fetchMlOrderCost("2000017243866816", "tok", fetchFn as unknown as typeof fetch)
    expect(result).toEqual({
      mlOrderId: "2000017243866816",
      saleFee: 32.26, // 13.63*2 + 5.00
      shippingCost: 12.35,
      listingType: "gold_pro",
      mlStatus: "paid",
      raw: expect.anything(),
    })
  })
  it("pedido inexistente (404) retorna null", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ error: "not_found" }, 404))
    expect(await fetchMlOrderCost("999", "tok", fetchFn as unknown as typeof fetch)).toBeNull()
  })
  it("sem shipping id o frete é 0", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({ id: 1, status: "paid", order_items: [{ quantity: 1, sale_fee: 10 }] }),
    )
    const result = await fetchMlOrderCost("1", "tok", fetchFn as unknown as typeof fetch)
    expect(result?.shippingCost).toBe(0)
    expect(result?.saleFee).toBe(10)
  })
})
