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
    const out = aplicarBaseValor([pedido({ valorVenda: 100, valorNota: 90 })], "nota")
    expect(out[0].valorVenda).toBe(90)
  })

  it("modo nota: pedido sem NF vira 0", () => {
    const out = aplicarBaseValor([pedido({ valorVenda: 100, valorNota: undefined })], "nota")
    expect(out[0].valorVenda).toBe(0)
  })

  it("modo nota: não muta os pedidos de entrada", () => {
    const pedidos = [pedido({ valorVenda: 100, valorNota: 90 })]
    aplicarBaseValor(pedidos, "nota")
    expect(pedidos[0].valorVenda).toBe(100)
  })
})
