import { afterEach, describe, expect, it, vi } from "vitest"
import { baixarContaReceber, fetchNotaSituacao, NOTA_SITUACOES_AUTORIZADAS } from "@/lib/olist-v3"

// Mutações na Olist NUNCA podem ser re-tentadas — nem em 429 (revisão 22/08,
// P0): o gateway pode ter aplicado a escrita antes de responder, e repetir
// duplicaria o recebimento/lançamento no ERP.
describe("mutações sem retry", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("baixar não repete a chamada em 429", async () => {
    let calls = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1
        return new Response("rate limited", { status: 429 })
      }),
    )
    await expect(
      baixarContaReceber("token", 123, { valorPago: 10, data: new Date("2026-08-22T12:00:00Z") }),
    ).rejects.toThrow(/429/)
    expect(calls).toBe(1)
  })

  it("baixar não repete a chamada em 500", async () => {
    let calls = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1
        return new Response("boom", { status: 500 })
      }),
    )
    await expect(
      baixarContaReceber("token", 123, { valorPago: 10, data: new Date("2026-08-22T12:00:00Z") }),
    ).rejects.toThrow(/500/)
    expect(calls).toBe(1)
  })
})

describe("fetchNotaSituacao", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("lê a situação da nota e o gate aceita só autorizada (6) e DANFE (7)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ id: 362004901, situacao: 6 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    )
    const situacao = await fetchNotaSituacao("token", 362004901)
    expect(situacao).toBe(6)
    expect(NOTA_SITUACOES_AUTORIZADAS.has(6)).toBe(true)
    expect(NOTA_SITUACOES_AUTORIZADAS.has(7)).toBe(true)
    // Pendente, emitida (pré-SEFAZ), cancelada, rejeitada, denegada: NÃO.
    for (const s of [1, 2, 3, 5, 10]) expect(NOTA_SITUACOES_AUTORIZADAS.has(s)).toBe(false)
  })
})
