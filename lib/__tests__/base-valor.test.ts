import { describe, expect, it } from "vitest"
import { aplicarBaseValor, type Pedido } from "@/lib/data"

function pedido(over: Partial<Pedido>): Pedido {
  return {
    id: "1",
    numeroPedido: "1",
    numeroNF: "-",
    sku: "SKU",
    produto: "Produto",
    canal: "Mercado Livre",
    vendedor: "Loja",
    formaPagamento: "Pix",
    valorVenda: 100,
    valorFrete: 0,
    devolucao: 0,
    taxaComissao: 0,
    custoTotal: 0,
    quantidade: 1,
    statusPagamento: "Pago",
    data: "2026-07-01",
    ...over,
  }
}

describe("aplicarBaseValor", () => {
  it("modo venda: retorna a mesma referência de lista, sem alterar valorVenda", () => {
    const pedidos = [pedido({ valorVenda: 100, valorNota: 90 })]
    const out = aplicarBaseValor(pedidos, "venda")
    expect(out).toBe(pedidos)
    expect(out[0].valorVenda).toBe(100)
  })

  it("modo nota: troca valorVenda pelo valorNota", () => {
    const out = aplicarBaseValor(
      [pedido({ valorVenda: 100, valorNota: 90, dataNota: "2026-08-20" })],
      "nota",
    )
    expect(out[0].valorVenda).toBe(90)
    expect(out[0].data).toBe("2026-08-20")
  })

  it("modo nota: pedido sem NF é descartado (recorte só faturados)", () => {
    const out = aplicarBaseValor([pedido({ valorVenda: 100, valorNota: undefined })], "nota")
    expect(out).toHaveLength(0)
  })

  it("modo nota: pedido sem data de emissão é descartado para não usar a data da venda", () => {
    const out = aplicarBaseValor([pedido({ valorVenda: 100, valorNota: 90 })], "nota")
    expect(out).toHaveLength(0)
  })

  it("modo nota: não muta os pedidos de entrada", () => {
    const pedidos = [pedido({ valorVenda: 100, valorNota: 90, dataNota: "2026-08-20" })]
    aplicarBaseValor(pedidos, "nota")
    expect(pedidos[0].valorVenda).toBe(100)
    expect(pedidos[0].data).toBe("2026-07-01")
  })
})

describe("aplicarBaseValor — composição com agregação", () => {
  it("soma de valorVenda no modo nota usa valorNota e ignora pedidos sem NF", () => {
    const pedidos = [
      pedido({ id: "a", valorVenda: 100, valorNota: 90, dataNota: "2026-07-02" }),
      pedido({ id: "b", valorVenda: 50, valorNota: undefined }),
    ]
    const out = aplicarBaseValor(pedidos, "nota")
    expect(out).toHaveLength(1)
    expect(out.reduce((s, p) => s + p.valorVenda, 0)).toBe(90)
  })
})
