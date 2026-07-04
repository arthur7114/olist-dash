import { describe, expect, it } from "vitest"
import { variacaoPct } from "@/lib/data"

describe("variacaoPct", () => {
  it("calcula variação relativa ao período anterior", () => {
    expect(variacaoPct(120, 100)).toBeCloseTo(0.2)
    expect(variacaoPct(80, 100)).toBeCloseTo(-0.2)
  })
  it("retorna undefined quando não há base de comparação", () => {
    expect(variacaoPct(100, 0)).toBeUndefined()
    expect(variacaoPct(100, NaN)).toBeUndefined()
  })
  it("usa valor absoluto da base para não inverter sinal com anterior negativo", () => {
    expect(variacaoPct(-50, -100)).toBeCloseTo(0.5)
  })
})
