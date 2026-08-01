import { describe, expect, it, vi } from "vitest"
import { fetchMlJson, syncMlProductMonth } from "@/lib/ml-product-sync"

describe("fetchMlJson", () => {
  it("retries a rate-limited Mercado Livre request without exposing the token", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "rate limited" }), {
          status: 429,
          headers: { "Content-Type": "application/json", "Retry-After": "0" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 123 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
    const delayFn = vi.fn().mockResolvedValue(undefined)

    const result = await fetchMlJson<{ id: number }>(
      "/users/me",
      "secret-token",
      undefined,
      fetchFn as typeof fetch,
      delayFn,
    )

    expect(result).toEqual({ id: 123 })
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(delayFn).toHaveBeenCalledOnce()
    expect(fetchFn.mock.calls[0][1]?.headers).toEqual({ Authorization: "Bearer secret-token" })
  })

  it("does not retry permanent client errors", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }))
    const delayFn = vi.fn().mockResolvedValue(undefined)

    await expect(
      fetchMlJson("/missing", "token", undefined, fetchFn as typeof fetch, delayFn),
    ).rejects.toThrow("Mercado Livre retornou 404")
    expect(fetchFn).toHaveBeenCalledOnce()
    expect(delayFn).not.toHaveBeenCalled()
  })
})

describe("syncMlProductMonth", () => {
  it("publishes sales with null visits when the visits endpoint is unavailable", async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes("/orders/search")) {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 42,
                status: "paid",
                date_created: "2026-07-15T10:00:00-03:00",
                order_items: [
                  {
                    item: { id: "MLB1", title: "Produto A", seller_sku: "SKU-A" },
                    quantity: 2,
                    unit_price: 50,
                  },
                ],
              },
            ],
            paging: { total: 1 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }
      if (url.includes("/visits/time_window")) {
        return new Response("visits unavailable", { status: 403 })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const metrics = await syncMlProductMonth(
      "2026-07",
      {
        sellerId: "seller-1",
        catalogItemIds: ["MLB1"],
        itemDetails: new Map([
          ["MLB1", { id: "MLB1", title: "Produto A", seller_custom_field: "SKU-A" }],
        ]),
      },
      "secret-token",
      fetchFn as typeof fetch,
    )

    expect(metrics).toHaveLength(1)
    expect(metrics[0]).toMatchObject({
      productKey: "SKU-A",
      paid: { orders: 1, units: 2, revenue: 100 },
      visits: null,
    })
  })
})
