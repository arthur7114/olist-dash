import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
  delete process.env.OLIST_MIN_REQUEST_INTERVAL_MS
})

describe("caixa da Olist", () => {
  it("monta o corpo do lançamento com data ISO de Fortaleza, conta e categoria", async () => {
    const { buildCaixaBody } = await import("@/lib/olist-v3")
    // 02:00 UTC do dia 27 ainda é dia 26 em Fortaleza (UTC-3).
    expect(
      buildCaixaBody({ data: new Date("2026-09-27T02:00:00Z"), historico: "Saque Shopee #9", valor: 55.839, tipo: "D", contaId: 10, categoriaId: 20 }),
    ).toEqual({ data: "2026-09-26", historico: "Saque Shopee #9", valor: 55.84, tipo: "D", conta: { id: 10 }, categoria: { id: 20 } })
  })

  it("POST /caixa devolve o id criado", async () => {
    process.env.OLIST_MIN_REQUEST_INTERVAL_MS = "1"
    const calls: Array<{ url: string; method?: string; body?: string }> = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(input), method: init?.method, body: init?.body as string })
        return new Response(JSON.stringify({ id: 777 }), { status: 200, headers: { "content-type": "application/json" } })
      }),
    )
    const { createCaixaLancamento } = await import("@/lib/olist-v3")
    const id = await createCaixaLancamento("tok", { data: new Date("2026-09-26T15:00:00Z"), historico: "h", valor: 1, tipo: "C", contaId: 1, categoriaId: 2 })
    expect(id).toBe(777)
    expect(calls[0].url).toMatch(/\/caixa$/)
    expect(calls[0].method).toBe("POST")
    expect(JSON.parse(calls[0].body!)).toMatchObject({ tipo: "C", conta: { id: 1 }, categoria: { id: 2 } })
  })
})
