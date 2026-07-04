import { describe, expect, it } from "vitest"
import { normalizarPeriodo, rangePeriodo } from "@/lib/periodo"

const REF = new Date("2026-07-04T15:30:00Z")

describe("rangePeriodo", () => {
  it("janela de N dias com comparação de mesma duração", () => {
    expect(rangePeriodo("7d", REF)).toEqual({
      inicio: "2026-06-28", fim: "2026-07-04",
      inicioAnterior: "2026-06-21", fimAnterior: "2026-06-27",
    })
  })
  it("mês atual compara com mesmo trecho do mês anterior", () => {
    expect(rangePeriodo("mes", REF)).toEqual({
      inicio: "2026-07-01", fim: "2026-07-04",
      inicioAnterior: "2026-06-01", fimAnterior: "2026-06-04",
    })
  })
  it("mês anterior completo compara com o retrasado", () => {
    expect(rangePeriodo("mes-anterior", REF)).toEqual({
      inicio: "2026-06-01", fim: "2026-06-30",
      inicioAnterior: "2026-05-01", fimAnterior: "2026-05-31",
    })
  })
  it("tudo não tem limites nem comparação", () => {
    expect(rangePeriodo("tudo", REF)).toEqual({
      inicio: null, fim: null, inicioAnterior: null, fimAnterior: null,
    })
  })
  it("fim de mês não estoura o mês anterior (31/03 → 28/02)", () => {
    expect(rangePeriodo("mes", new Date("2026-03-31T12:00:00Z")).fimAnterior).toBe("2026-02-28")
  })
})

describe("normalizarPeriodo", () => {
  it("aceita valores válidos e usa 30d como fallback", () => {
    expect(normalizarPeriodo("90d")).toBe("90d")
    expect(normalizarPeriodo("mes")).toBe("mes")
    expect(normalizarPeriodo("xyz")).toBe("30d")
    expect(normalizarPeriodo(null)).toBe("30d")
  })
})
