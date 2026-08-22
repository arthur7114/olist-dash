import { describe, expect, it } from "vitest"
import { indexNotaFacts, indexNotaValues } from "@/lib/olist-v3"

describe("indexNotaValues", () => {
  it("mapeia id da nota para o valor", () => {
    const m = indexNotaValues([
      { id: 10, valor: 250.5 },
      { id: 11, valor: 99 },
    ])
    expect(m.get(10)).toBe(250.5)
    expect(m.get(11)).toBe(99)
  })

  it("ignora notas sem id ou sem valor positivo", () => {
    const m = indexNotaValues([{ valor: 100 }, { id: 13, valor: 0 }, { id: 14 }])
    expect(m.size).toBe(0)
  })

  it("ignora notas canceladas (situacao 3)", () => {
    const m = indexNotaValues([
      { id: 15, valor: 200, situacao: 3 },
      { id: 16, valor: 300, situacao: 6 },
    ])
    expect(m.has(15)).toBe(false)
    expect(m.get(16)).toBe(300)

    const facts = indexNotaFacts([{ id: 15, valor: 200, situacao: 3 }])
    expect(facts.get(15)).toEqual({ valor: 0, cancelada: true })
  })
})

describe("indexNotaFacts", () => {
  it("preserva valor e data de emissão da nota", () => {
    const facts = indexNotaFacts([
      { id: 20, valor: 24_667.5, dataEmissao: "2026-08-20 16:44:07", situacao: 6 },
    ])

    expect(facts.get(20)).toEqual({ valor: 24_667.5, dataEmissao: "2026-08-20" })
  })
})
