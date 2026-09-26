import { describe, expect, it } from "vitest"
import { kitCostFromComponents, kitNeedsUpdate, parseCustoPlanilha } from "@/lib/olist-custos"

describe("kitCostFromComponents", () => {
  it("soma componente vezes quantidade, arredondado em centavos", () => {
    expect(kitCostFromComponents([{ custo: 11.43, quantidade: 5 }])).toBe(57.15)
    expect(kitCostFromComponents([{ custo: 106.36, quantidade: 1 }, { custo: 56.89, quantidade: 1 }, { custo: 50.7, quantidade: 1 }])).toBe(213.95)
  })

  it("zera o kit quando falta custo ou quantidade em algum componente", () => {
    expect(kitCostFromComponents([{ custo: 651.41, quantidade: 1 }, { custo: 0, quantidade: 1 }])).toBe(0)
    expect(kitCostFromComponents([{ custo: 10, quantidade: 0 }])).toBe(0)
    expect(kitCostFromComponents([])).toBe(0)
  })
})

describe("kitNeedsUpdate", () => {
  it("regrava quando o cadastro está vazio ou desatualizado", () => {
    expect(kitNeedsUpdate(0, 415.42)).toBe(true)
    expect(kitNeedsUpdate(248.01, 251.41)).toBe(true)
  })

  it("não mexe quando já bate ou quando a soma não fecha", () => {
    expect(kitNeedsUpdate(27.38, 27.38)).toBe(false)
    expect(kitNeedsUpdate(0, 0)).toBe(false)
  })
})

describe("parseCustoPlanilha", () => {
  it("lê número e texto em formato brasileiro ou com ponto", () => {
    expect(parseCustoPlanilha(123.456)).toEqual({ ok: true, custo: 123.46 })
    expect(parseCustoPlanilha("R$ 1.234,56")).toEqual({ ok: true, custo: 1234.56 })
    expect(parseCustoPlanilha("89,9")).toEqual({ ok: true, custo: 89.9 })
    expect(parseCustoPlanilha("89.90")).toEqual({ ok: true, custo: 89.9 })
    expect(parseCustoPlanilha("1.234")).toEqual({ ok: true, custo: 1234 })
  })

  it("vazio é linha não preenchida; lixo e zero são erro", () => {
    expect(parseCustoPlanilha("")).toEqual({ ok: "vazio" })
    expect(parseCustoPlanilha(null)).toEqual({ ok: "vazio" })
    expect(parseCustoPlanilha("abc").ok).toBe(false)
    expect(parseCustoPlanilha(0).ok).toBe(false)
    expect(parseCustoPlanilha("-5").ok).toBe(false)
  })
})
