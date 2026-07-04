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
  it("numeroPedidoEcommerce é pack_id: cai para /packs e soma os pedidos do pacote", async () => {
    const fetchFn = vi.fn().mockImplementation((url: string) => {
      const u = String(url)
      if (u.includes("/orders/2000013834311875")) return Promise.resolve(jsonResponse({ error: "not_found" }, 404))
      if (u.includes("/packs/2000013834311875")) {
        return Promise.resolve(
          jsonResponse({ id: 2000013834311875, shipment: { id: 47443363572 }, orders: [{ id: 2000017242461256 }] }),
        )
      }
      if (u.includes("/orders/2000017242461256")) {
        return Promise.resolve(
          jsonResponse({
            id: 2000017242461256,
            status: "paid",
            order_items: [{ quantity: 1, sale_fee: 20, listing_type_id: "gold_pro" }],
          }),
        )
      }
      if (u.includes("/shipments/47443363572/costs")) {
        return Promise.resolve(jsonResponse({ senders: [{ cost: 15 }] }))
      }
      return Promise.resolve(jsonResponse({ error: "not_found" }, 404))
    })
    const result = await fetchMlOrderCost("2000013834311875", "tok", fetchFn as unknown as typeof fetch)
    expect(result).toEqual({
      mlOrderId: "2000013834311875",
      saleFee: 20,
      shippingCost: 15,
      listingType: "gold_pro",
      mlStatus: "paid",
      raw: expect.anything(),
    })
  })
  it("pack sem pedidos resolvíveis retorna null", async () => {
    const fetchFn = vi.fn().mockImplementation((url: string) => {
      const u = String(url)
      if (u.includes("/orders/")) return Promise.resolve(jsonResponse({ error: "not_found" }, 404))
      if (u.includes("/packs/")) return Promise.resolve(jsonResponse({ id: 1, orders: [] }))
      return Promise.resolve(jsonResponse({ error: "not_found" }, 404))
    })
    expect(await fetchMlOrderCost("1", "tok", fetchFn as unknown as typeof fetch)).toBeNull()
  })
})
