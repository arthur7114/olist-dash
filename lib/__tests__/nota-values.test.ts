import { describe, expect, it } from "vitest"
import { indexNotaValues } from "@/lib/olist-v3"

describe("indexNotaValues", () => {
  it("mapeia id da nota para o valor", () => {
    const m = indexNotaValues([
      { id: 10, valor: 250.5 },
      { id: 11, valor: 99 },
    ])
    expect(m.get(10)).toBe(250.5)
    expect(m.get(11)).toBe(99)
  })

  it("aceita o campo valorNota como alternativa a valor", () => {
    const m = indexNotaValues([{ id: 12, valorNota: 42 }])
    expect(m.get(12)).toBe(42)
  })

  it("ignora notas sem id ou sem valor positivo", () => {
    const m = indexNotaValues([{ valor: 100 }, { id: 13, valor: 0 }, { id: 14 }])
    expect(m.size).toBe(0)
  })
})
