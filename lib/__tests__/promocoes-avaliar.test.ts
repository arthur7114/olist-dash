import { describe, expect, it } from "vitest"
import { avaliarOferta, type OfertaLinha } from "@/lib/promocoes/margem"

const hoje = new Date("2026-09-26T12:00:00Z")

// Anúncio Premium (17%), fora do Full, sem tarifa/frete medidos: frete da faixa 79–200 = R$ 16,12.
const oferta: OfertaLinha = {
  itemId: "MLB1",
  sku: "6103",
  titulo: "Filtro de óleo",
  tipoAnuncio: "gold_pro",
  logistica: "cross_docking",
  precoAtual: 100,
  precoPromo: 90,
  precoOriginal: 100,
  reducaoTarifa: 0,
  estoque: 50,
  vendas14d: 0,
  tipo: "DEAL",
  nome: "9.9",
  situacao: "candidate",
  fim: "2026-10-10",
}
const custo = { custo: 40, data: "2026-09-20" }

describe("avaliarOferta", () => {
  it("MC entre 5% e 15% só entra com objetivo", () => {
    // 90 − 40 − 15,30 (tarifa) − 16,12 (frete) − 5,436 (ICMS 6,04%) = 13,144 → 14,6%
    const r = avaliarOferta(oferta, { custo, agora: hoje })
    expect(r.classe).toBe("só com objetivo")
    expect(r.mcPromo).toBeCloseTo(13.144, 3)
    expect(r.mcPromoPct).toBeCloseTo(0.14604, 4)
  })

  it("redução de tarifa bancada pelo ML entra na margem", () => {
    // 13,144 + 2,00 = 15,144 → 16,8%
    const r = avaliarOferta({ ...oferta, reducaoTarifa: 2 }, { custo, agora: hoje })
    expect(r.classe).toBe("recomendada")
    expect(r.mcPromoPct).toBeCloseTo(0.16827, 4)
  })

  it("abaixo de 5% de margem recusa", () => {
    // preço 70: 70 − 40 − 11,90 − 9,33 (faixa até 79) − 4,228 = 4,542 → 6,5%; custo 45 → −0,458
    const r = avaliarOferta({ ...oferta, precoPromo: 70 }, { custo: { custo: 45, data: "2026-09-20" }, agora: hoje })
    expect(r.classe).toBe("recusar")
    expect(r.mcPromo).toBeCloseTo(-0.458, 3)
  })

  it("sem custo na Olist fica bloqueada", () => {
    const r = avaliarOferta(oferta, { custo: null, agora: hoje })
    expect(r.classe).toBe("bloqueada")
    expect(r.motivo).toBe("sem custo na Olist")
  })

  it("estoque baixo rebaixa a recomendada para recomendada com alerta", () => {
    const r = avaliarOferta({ ...oferta, reducaoTarifa: 2, estoque: 5 }, { custo, agora: hoje })
    expect(r.classe).toBe("recomendada com alerta")
    expect(r.motivo).toContain("estoque 5 < 10")
  })
})
