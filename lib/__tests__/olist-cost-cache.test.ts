import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
  delete process.env.OLIST_PRODUCT_COST_TTL_MS
  delete process.env.OLIST_MIN_REQUEST_INTERVAL_MS
})

describe("cache persistente de custos da Olist", () => {
  it("consulta a Olist quando o custo persistido já venceu", async () => {
    process.env.OLIST_PRODUCT_COST_TTL_MS = "1000"
    process.env.OLIST_MIN_REQUEST_INTERVAL_MS = "1"

    let apiCalls = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        apiCalls += 1
        const url = String(input)
        const product = {
          id: 348319234,
          sku: "416101R100 / KAC1180",
          precos: { precoCusto: 152.54, precoCustoMedio: 152.54 },
        }
        return new Response(JSON.stringify(url.includes("/produtos?") ? { itens: [product] } : product), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }),
    )

    const {
      exportProductCostCache,
      markProductCostsPersisted,
      primeProductCostCache,
      recomputeCostsForRaws,
    } = await import("@/lib/olist-v3")
    primeProductCostCache([
      { ref: "id:348319234", custo: 342.5, updatedAt: new Date("2026-07-01T00:00:00Z") },
      { ref: "sku:416101R100 / KAC1180", custo: 342.5, updatedAt: new Date("2026-07-01T00:00:00Z") },
    ])

    const [result] = await recomputeCostsForRaws("fake-token", [
      {
        id: 363630453,
        numeroPedido: 3844,
        data: "2026-08-20",
        valorTotalProdutos: 24_667.5,
        itens: [
          {
            produto: {
              id: 348319234,
              sku: "416101R100 / KAC1180",
              descricao: "Cilindro mestre",
            },
            quantidade: 110,
            valorUnitario: 224.25,
          },
        ],
      },
    ])

    expect(apiCalls).toBeGreaterThan(0)
    expect(result.custoTotal).toBe(16_779.4)

    const pending = exportProductCostCache()
    expect(pending.length).toBeGreaterThan(0)
    expect(exportProductCostCache()).toEqual(pending)
    markProductCostsPersisted(pending)
    expect(exportProductCostCache()).toEqual([])
  })
})
