import { describe, expect, it } from "vitest"
import { statusPorSituacao } from "@/lib/data"

describe("statusPorSituacao", () => {
  it("mapeia situações pagas (faturado/aprovado/logística)", () => {
    for (const s of [1, 3, 4, 5, 6, 7]) expect(statusPorSituacao(s, "Pendente")).toBe("Pago")
  })
  it("cancelado vira Estornado", () => {
    expect(statusPorSituacao(2, "Pago")).toBe("Estornado")
  })
  it("em aberto/incompleto vira Pendente", () => {
    expect(statusPorSituacao(0, "Pago")).toBe("Pendente")
    expect(statusPorSituacao(8, "Pago")).toBe("Pendente")
  })
  it("sem situação usa o fallback persistido", () => {
    expect(statusPorSituacao(null, "Parcial")).toBe("Parcial")
    expect(statusPorSituacao(undefined, "Pago")).toBe("Pago")
  })
})
