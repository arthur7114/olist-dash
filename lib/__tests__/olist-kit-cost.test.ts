import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
  delete process.env.OLIST_MIN_REQUEST_INTERVAL_MS
})

type Produto = {
  id: number
  sku: string
  tipo?: string
  precos?: { precoCusto?: number; precoCustoMedio?: number }
  kit?: Array<{ produto: { id: number; sku: string }; quantidade: number }>
}

// Kit da Olist: sem custo próprio, com dois componentes simples.
const KIT: Produto = {
  id: 100,
  sku: "34572G/34573G",
  tipo: "K",
  precos: { precoCusto: 0, precoCustoMedio: 0 },
  kit: [
    { produto: { id: 101, sku: "34572G" }, quantidade: 1 },
    { produto: { id: 102, sku: "34573G" }, quantidade: 2 },
  ],
}

function stubOlist(produtos: Produto[]) {
  const byId = new Map(produtos.map((p) => [p.id, p]))
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
      if (url.pathname.endsWith("/produtos")) {
        const codigo = url.searchParams.get("codigo")
        const p = produtos.find((x) => x.sku === codigo)
        // A listagem traz tipo, mas não os componentes do kit, igual à API real.
        return json({ itens: p ? [{ id: p.id, sku: p.sku, tipo: p.tipo, precos: p.precos }] : [] })
      }
      const custos = url.pathname.match(/\/produtos\/(\d+)\/custos$/)
      if (custos) return json({ itens: [] })
      const detalhe = url.pathname.match(/\/produtos\/(\d+)$/)
      if (detalhe) return json(byId.get(Number(detalhe[1])) ?? {})
      return json({})
    }),
  )
}

describe("custo de kit da Olist", () => {
  it("fetchCostsBySku soma o custo dos componentes vezes a quantidade", async () => {
    process.env.OLIST_MIN_REQUEST_INTERVAL_MS = "1"
    stubOlist([
      KIT,
      { id: 101, sku: "34572G", tipo: "S", precos: { precoCusto: 200, precoCustoMedio: 207.71 } },
      { id: 102, sku: "34573G", tipo: "S", precos: { precoCusto: 207.71, precoCustoMedio: 0 } },
    ])
    const { fetchCostsBySku } = await import("@/lib/olist-v3")

    const costs = await fetchCostsBySku("fake-token", ["34572G/34573G"])

    expect(costs.get("34572G/34573G")).toEqual({ cost: 623.13, id: 100, found: true })
  })

  it("kit com componente sem custo fica sem custo, em vez de custo parcial", async () => {
    process.env.OLIST_MIN_REQUEST_INTERVAL_MS = "1"
    stubOlist([
      KIT,
      { id: 101, sku: "34572G", tipo: "S", precos: { precoCusto: 207.71, precoCustoMedio: 207.71 } },
      { id: 102, sku: "34573G", tipo: "S", precos: { precoCusto: 0, precoCustoMedio: 0 } },
    ])
    const { fetchCostsBySku } = await import("@/lib/olist-v3")

    const costs = await fetchCostsBySku("fake-token", ["34572G/34573G"])

    expect(costs.get("34572G/34573G")).toEqual({ cost: 0, id: 100, found: true })
  })

  it("custo digitado no cadastro do kit perde para a soma dos componentes", async () => {
    process.env.OLIST_MIN_REQUEST_INTERVAL_MS = "1"
    stubOlist([
      { ...KIT, precos: { precoCusto: 380, precoCustoMedio: 380 } },
      { id: 101, sku: "34572G", tipo: "S", precos: { precoCusto: 207.71, precoCustoMedio: 207.71 } },
      { id: 102, sku: "34573G", tipo: "S", precos: { precoCusto: 207.71, precoCustoMedio: 207.71 } },
    ])
    const { fetchCostsBySku } = await import("@/lib/olist-v3")

    const costs = await fetchCostsBySku("fake-token", ["34572G/34573G"])

    expect(costs.get("34572G/34573G")?.cost).toBe(623.13)
  })

  it("kit com componente sem custo usa o custo do cadastro do kit, se houver", async () => {
    process.env.OLIST_MIN_REQUEST_INTERVAL_MS = "1"
    stubOlist([
      { ...KIT, precos: { precoCusto: 380, precoCustoMedio: 380 } },
      { id: 101, sku: "34572G", tipo: "S", precos: { precoCusto: 207.71, precoCustoMedio: 207.71 } },
      { id: 102, sku: "34573G", tipo: "S", precos: { precoCusto: 0, precoCustoMedio: 0 } },
    ])
    const { fetchCostsBySku } = await import("@/lib/olist-v3")

    const costs = await fetchCostsBySku("fake-token", ["34572G/34573G"])

    expect(costs.get("34572G/34573G")?.cost).toBe(380)
  })

  it("pedido com kit ganha o custo dos componentes", async () => {
    process.env.OLIST_MIN_REQUEST_INTERVAL_MS = "1"
    stubOlist([
      KIT,
      { id: 101, sku: "34572G", tipo: "S", precos: { precoCusto: 207.71, precoCustoMedio: 207.71 } },
      { id: 102, sku: "34573G", tipo: "S", precos: { precoCusto: 207.71, precoCustoMedio: 207.71 } },
    ])
    const { recomputeCostsForRaws } = await import("@/lib/olist-v3")

    const [result] = await recomputeCostsForRaws("fake-token", [
      {
        id: 1,
        numeroPedido: 1,
        data: "2026-09-20",
        valorTotalProdutos: 1540.7,
        itens: [
          {
            produto: { id: 100, sku: "34572G/34573G", descricao: "Par amortecedor" },
            quantidade: 2,
            valorUnitario: 770.35,
          },
        ],
      },
    ])

    expect(result.custoTotal).toBe(1246.26)
  })
})
