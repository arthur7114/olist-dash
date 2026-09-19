import { describe, expect, it } from "vitest"
import {
  buildPutBody,
  computeDelta,
  descriptionToHtml,
  dimsFromAttributes,
  isDeltaEmpty,
  pickBestListing,
  skipReasonFor,
  toCm,
  toKg,
  type MlCatalog,
} from "@/lib/olist-catalog-fill"
import type { TinyProductFull } from "@/lib/olist-v3"

const fullCatalog = (over: Partial<MlCatalog> = {}): MlCatalog => ({
  itemId: "MLB1",
  soldQuantity: 0,
  description: "Peça original",
  pictures: ["https://a/1.jpg"],
  dims: { comprimento: 12, largura: 15, altura: 40, pesoBruto: 1.8 },
  ...over,
})

describe("conversão de medidas", () => {
  it("peso em g vira kg; kg fica; sem unidade assume g", () => {
    expect(toKg("1800 g")).toBe(1.8)
    expect(toKg("6850 g")).toBe(6.85)
    expect(toKg("2 kg")).toBe(2)
    expect(toKg("1,5 kg")).toBe(1.5)
    expect(toKg("500")).toBe(0.5)
    expect(toKg(null)).toBeUndefined()
    expect(toKg("0 g")).toBeUndefined()
  })

  it("comprimento em cm fica; mm e m convertem", () => {
    expect(toCm("40 cm")).toBe(40)
    expect(toCm("400 mm")).toBe(40)
    expect(toCm("1.2 m")).toBe(120)
    expect(toCm("abc")).toBeUndefined()
  })

  it("monta dims só com o que existe", () => {
    expect(
      dimsFromAttributes([
        { id: "SELLER_PACKAGE_HEIGHT", value_name: "40 cm" },
        { id: "SELLER_PACKAGE_WEIGHT", value_name: "1800 g" },
        { id: "SELLER_SKU", value_name: "6021" },
      ]),
    ).toEqual({ altura: 40, pesoBruto: 1.8 })
  })
})

describe("pickBestListing", () => {
  it("prefere o mais completo, depois o mais vendido, depois o menor id", () => {
    const incomplete = fullCatalog({ itemId: "MLB0", soldQuantity: 99, pictures: [] })
    const soldMore = fullCatalog({ itemId: "MLB9", soldQuantity: 5 })
    const soldLess = fullCatalog({ itemId: "MLB2", soldQuantity: 1 })
    expect(pickBestListing([incomplete, soldLess, soldMore])?.itemId).toBe("MLB9")

    const tieA = fullCatalog({ itemId: "MLB5" })
    const tieB = fullCatalog({ itemId: "MLB3" })
    expect(pickBestListing([tieA, tieB])?.itemId).toBe("MLB3")
    expect(pickBestListing([])).toBeUndefined()
  })
})

describe("descriptionToHtml", () => {
  it("escapa e troca quebras por <br>", () => {
    expect(descriptionToHtml("A & B <c>\r\nlinha 2\n")).toBe("A &amp; B &lt;c&gt;<br>linha 2")
  })
})

describe("skipReasonFor", () => {
  it("pula inativo, variação e sem descricao", () => {
    expect(skipReasonFor({ situacao: "I", descricao: "x" })).toBe("olist_inativo")
    expect(skipReasonFor({ situacao: "A", tipo: "V", descricao: "x" })).toBe("olist_com_variacao")
    expect(skipReasonFor({ situacao: "A", tipoVariacao: "V", descricao: "x" })).toBe("olist_com_variacao")
    expect(skipReasonFor({ situacao: "A", descricao: " " })).toBe("olist_sem_descricao")
    expect(skipReasonFor({ situacao: "A", tipo: "S", descricao: "x" })).toBeUndefined()
  })
})

describe("computeDelta", () => {
  const empty: TinyProductFull = { id: 1, descricao: "Peça" }

  it("Olist vazia recebe tudo", () => {
    const delta = computeDelta(empty, fullCatalog(), [])
    expect(delta.descricaoComplementar).toBe("Peça original")
    expect(delta.dimensoes).toEqual({ largura: 15, altura: 40, comprimento: 12, pesoBruto: 1.8 })
    expect(delta.anexos).toEqual(["https://a/1.jpg"])
  })

  it("Olist preenchida não recebe nada", () => {
    const filled: TinyProductFull = {
      ...empty,
      descricaoComplementar: "já tem",
      dimensoes: { largura: 1, altura: 1, comprimento: 1, pesoBruto: 1 },
    }
    const delta = computeDelta(filled, fullCatalog(), [{ url: "https://x/1.jpg" }])
    expect(isDeltaEmpty(delta)).toBe(true)
  })

  it("dimensões são campo a campo; zero conta como vazio", () => {
    const partial: TinyProductFull = { ...empty, dimensoes: { largura: 10, altura: 0, comprimento: null } }
    const delta = computeDelta(partial, fullCatalog(), [])
    expect(delta.dimensoes).toEqual({ altura: 40, comprimento: 12, pesoBruto: 1.8 })
  })

  it("ML sem dado não gera delta e fotos são limitadas a 10", () => {
    const sparse = fullCatalog({ description: null, dims: {}, pictures: Array.from({ length: 12 }, (_, i) => `https://a/${i}.jpg`) })
    const delta = computeDelta(empty, sparse, null)
    expect(delta.descricaoComplementar).toBeUndefined()
    expect(delta.dimensoes).toBeUndefined()
    expect(delta.anexos).toHaveLength(10)
  })
})

describe("buildPutBody", () => {
  const product: TinyProductFull = {
    id: 7,
    sku: "6021",
    descricao: "Alavanca",
    ncm: "8708.99.90",
    marca: { id: 3, nome: "Fiat" },
    categoria: { id: 9, nome: "Câmbio" },
    precos: { preco: 100, precoCusto: 60, precoCustoMedio: 58 },
    dimensoes: { largura: 10, altura: null, quantidadeVolumes: 1 } as TinyProductFull["dimensoes"],
    estoque: { controlar: true, quantidade: 4 },
    anexos: [{ id: 1, url: "x" }],
  }

  it("preserva o GET, aplica o delta e descarta o que o PUT não aceita", () => {
    const body = buildPutBody(product, {
      descricaoComplementar: "desc",
      dimensoes: { altura: 40, pesoBruto: 1.8 },
    })
    expect(body).toMatchObject({
      sku: "6021",
      descricao: "Alavanca",
      ncm: "8708.99.90",
      descricaoComplementar: "desc",
      marca: { id: 3 },
      categoria: { id: 9 },
      precos: { preco: 100, precoCusto: 60 },
      dimensoes: { largura: 10, altura: 40, pesoBruto: 1.8 },
      estoque: { controlar: true },
    })
    expect(body).not.toHaveProperty("anexos")
    expect(body).not.toHaveProperty("id")
    expect((body.precos as Record<string, unknown>).precoCustoMedio).toBeUndefined()
    expect((body.dimensoes as Record<string, unknown>).quantidadeVolumes).toBeUndefined()
    expect((body.estoque as Record<string, unknown>).quantidade).toBeUndefined()
  })

  it("falha sem descricao", () => {
    expect(() => buildPutBody({ id: 1 }, {})).toThrow(/descricao/)
  })
})
