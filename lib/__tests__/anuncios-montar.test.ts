import { describe, expect, it } from "vitest"
import { MOLDE_AMORTECEDOR_TAMPA as M } from "@/lib/anuncios/molde"
import {
  checarFicha,
  embalagemDoFormato,
  familiasDeVeiculo,
  fotosDoFormato,
  lotesDeCompatibilidade,
  montarDescricao,
  montarItem,
  montarTitulo,
  veiculosTexto,
  type Ficha,
} from "@/lib/anuncios/montar"

// SW0856, já publicado à mão (MLB7994808948): serve de gabarito.
const kwid: Ficha = {
  sku: "SW0856",
  oem: "904501869R",
  aplicacoes: [{ marca: "RENAULT", modelo: "KWID", anoInicio: 2017 }],
  comprimentoAbertoCm: 32,
  comprimentoFechadoCm: 21,
  embalagem: { larguraCm: 5, alturaCm: 2, comprimentoCm: 36, pesoKg: 0.172 },
  similares: { cofap: "MGC16650", nakata: "MG 17365" },
  fotos: { carro: "https://x/carro.jpg", carroPar: "https://x/par.jpg", medidas: "https://x/med.jpg", aplicacao: "https://x/app.jpg" },
}

describe("checarFicha", () => {
  it("ficha completa não trava nem pergunta", () => {
    expect(checarFicha(kwid, 2026)).toEqual({ travas: [], perguntas: [] })
  })

  it("sem OEM, aplicação ou foto trava; medida faltando vira pergunta", () => {
    const r = checarFicha({ sku: "SW0888", oem: "", aplicacoes: [], fotos: {} }, 2026)
    expect(r.travas).toEqual(expect.arrayContaining(["código OEM original", "aplicação (marca, modelo e ano inicial)", "foto do carro com 1 amortecedor (link)"]))
    expect(r.perguntas).toEqual(expect.arrayContaining(["comprimento aberto (cm)", "peso da embalagem da unidade (kg)"]))
  })

  it("ano final antes do inicial e fechado maior que aberto são apontados", () => {
    const r = checarFicha({ ...kwid, aplicacoes: [{ marca: "Peugeot", modelo: "206", anoInicio: 2010, anoFim: 2005 }], comprimentoFechadoCm: 40 }, 2026)
    expect(r.travas).toContain("ano final da aplicação")
    expect(r.perguntas.some((p) => p.includes("fechado ficou maior"))).toBe(true)
  })
})

describe("título", () => {
  it("unitário igual ao publicado à mão", () => {
    expect(montarTitulo(M, "unidade", kwid)).toBe("Amortecedor Porta Mala Traseira Renault Kwid 904501869R")
  })

  it("par segue o padrão do roteiro", () => {
    expect(montarTitulo(M, "par", kwid)).toBe("Par Amortecedor Tampa Mala Traseira Renault Kwid 904501869R")
  })

  it("nunca passa de 60 e sempre tem o OEM: encurta prefixo, depois tira modelos", () => {
    const longa: Ficha = {
      ...kwid,
      oem: "E3B5A406A10AD",
      aplicacoes: [
        { marca: "Peugeot", modelo: "206", anoInicio: 2005, anoFim: 2010 },
        { marca: "Peugeot", modelo: "207", anoInicio: 2008, anoFim: 2012 },
        { marca: "Peugeot", modelo: "206 SW", anoInicio: 2005, anoFim: 2010 },
      ],
    }
    for (const formato of ["unidade", "par"] as const) {
      const t = montarTitulo(M, formato, longa)!
      expect(t.length).toBeLessThanOrEqual(60)
      expect(t.endsWith("E3B5A406A10AD")).toBe(true)
    }
  })

  it("devolve null quando nem o mais curto cabe", () => {
    expect(montarTitulo(M, "par", { ...kwid, oem: "X".repeat(40) })).toBeNull()
  })

  it("junta modelos da mesma marca", () => {
    expect(veiculosTexto([{ marca: "PEUGEOT", modelo: "206", anoInicio: 2005 }, { marca: "peugeot", modelo: "207", anoInicio: 2008 }])).toBe("Peugeot 206 207")
  })
})

describe("descrição", () => {
  it("bloco de cima igual ao publicado à mão", () => {
    const d = montarDescricao(M, "unidade", kwid)
    expect(d.startsWith(
      "AMORTECEDOR PORTA MALA TRASEIRA RENAULT KWID 904501869R\n\nAPLICAÇÕES\n- RENAULT KWID 2017 em diante\n\nSIMILARES:\nCOFAP - MGC16650\nNAKATA - MG 17365\nRENAULT - 904501869R\n\n***AMORTECEDOR PORTA MALA TAMPA TRASEIRA***\n\n***PRODUTO NOVO",
    )).toBe(true)
  })

  it("par começa com PAR; sem similares, só a linha da montadora", () => {
    const d = montarDescricao(M, "par", { ...kwid, similares: null })
    expect(d.startsWith("PAR AMORTECEDOR PORTA MALA TRASEIRA RENAULT KWID 904501869R")).toBe(true)
    expect(d).toContain("SIMILARES:\nRENAULT - 904501869R\n")
    expect(d).toContain("***PAR AMORTECEDOR PORTA MALA TAMPA TRASEIRA***")
  })

  it("aplicação com ano final mostra o intervalo", () => {
    const d = montarDescricao(M, "unidade", { ...kwid, aplicacoes: [{ marca: "Peugeot", modelo: "206", anoInicio: 2005, anoFim: 2010 }] })
    expect(d).toContain("- PEUGEOT 206 2005 a 2010")
  })
})

describe("embalagem e fotos", () => {
  it("par dobra largura e peso", () => {
    expect(embalagemDoFormato("unidade", kwid)).toEqual({ larguraCm: 5, alturaCm: 2, comprimentoCm: 36, pesoKg: 0.172 })
    expect(embalagemDoFormato("par", kwid)).toEqual({ larguraCm: 10, alturaCm: 2, comprimentoCm: 36, pesoKg: 0.344 })
  })

  it("troca carro, medidas e aplicação e mantém as genéricas na ordem do modelo", () => {
    const u = fotosDoFormato(M, "unidade", kwid)
    expect(u).toHaveLength(7)
    expect([u[0], u[3], u[5]]).toEqual(["https://x/carro.jpg", "https://x/med.jpg", "https://x/app.jpg"])
    expect(fotosDoFormato(M, "par", kwid)[0]).toBe("https://x/par.jpg")
  })
})

describe("montarItem", () => {
  it("unitário com GTIN da Olist e SKU simples", () => {
    const item = montarItem(M, "unidade", kwid, { sku: "SW0856", gtin: "7899932708565", estoque: 100 }, "T")
    const a = Object.fromEntries(item.attributes.map((x) => [x.id, x.value_name]))
    expect(item).toMatchObject({ family_name: "T", category_id: "MLB194779", price: 39.9, available_quantity: 100, listing_type_id: "gold_special" })
    expect(a).toMatchObject({
      BRAND: "SW",
      OEM: "904501869R",
      PART_NUMBER: "904501869R MGC16650",
      MODEL: "Amortecedor da Tampa Mala Traseira Renault Kwid",
      EXTENDED_LENGTH: "32 cm",
      COMPRESSED_LENGTH: "21 cm",
      SALE_FORMAT: "Unidade",
      UNITS_PER_PACK: "1",
      SELLER_SKU: "SW0856",
      GTIN: "7899932708565",
      SELLER_PACKAGE_WEIGHT: "172 g",
    })
    expect(a.EMPTY_GTIN_REASON).toBeUndefined()
  })

  it("par: kit, 2 unidades, sem GTIN, embalagem dobrada, preço do par", () => {
    const item = montarItem(M, "par", kwid, { sku: "SW0856 - PAR", gtin: "", estoque: 50 }, "T")
    const a = Object.fromEntries(item.attributes.map((x) => [x.id, x.value_name]))
    expect(item.price).toBe(67.45)
    expect(a).toMatchObject({ SALE_FORMAT: "Kit", UNITS_PER_PACK: "2", SELLER_SKU: "SW0856 - PAR", EMPTY_GTIN_REASON: "Outro motivo", SELLER_PACKAGE_WIDTH: "10 cm", SELLER_PACKAGE_WEIGHT: "344 g" })
    expect(a.GTIN).toBeUndefined()
  })
})

describe("compatibilidades", () => {
  it("um ano por família; sem ano final vai até o ano que vem", () => {
    expect(familiasDeVeiculo([{ marca: "Renault", modelo: "Kwid", anoInicio: 2024 }], 2026).map((f) => f.ano)).toEqual([2024, 2025, 2026, 2027])
    expect(familiasDeVeiculo([{ marca: "Peugeot", modelo: "206", anoInicio: 2008, anoFim: 2009 }], 2026)).toHaveLength(2)
  })

  it("lotes de até 10 famílias e 200 veículos, pulando ano sem veículo", () => {
    const fams = Array.from({ length: 12 }, (_, i) => ({ ano: 2010 + i, veiculos: i === 0 ? 0 : 30 }))
    const lotes = lotesDeCompatibilidade(fams)
    expect(lotes.every((l) => l.length <= 10 && l.reduce((s, f) => s + f.veiculos, 0) <= 200)).toBe(true)
    expect(lotes.flat()).toHaveLength(11)
  })
})
