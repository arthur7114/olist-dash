import { describe, expect, it } from "vitest"
import { calcularKpisDevolucao, devolucaoPorCanal, devolucaoPorMes } from "@/lib/devolucao-analytics"
import type { Pedido } from "@/lib/data"

function pedido(parcial: Partial<Pedido>): Pedido {
  return {
    id: "1", numeroPedido: "P1", numeroNF: "-", sku: "A", produto: "Prod A",
    canal: "Mercado Livre", vendedor: "Sem vendedor", formaPagamento: "Pix",
    valorVenda: 100, valorFrete: 0, devolucao: 0, taxaComissao: 0, custoTotal: 0,
    quantidade: 1, statusPagamento: "Pago", data: "2026-06-10",
    ...parcial,
  }
}

const PEDIDOS = [
  pedido({}),
  pedido({ id: "2", devolucao: 100, quantidade: 2, data: "2026-06-15" }),
  pedido({ id: "3", devolucao: 50, valorVenda: 50, sku: "B", canal: "Olist ERP", data: "2026-05-02" }),
]

describe("calcularKpisDevolucao", () => {
  it("conta pedidos, itens, SKUs e valores devolvidos", () => {
    const k = calcularKpisDevolucao(PEDIDOS)
    expect(k.pedidosDevolvidos).toBe(2)
    expect(k.itensDevolvidos).toBe(3) // 2 + 1
    expect(k.skusDevolvidos).toBe(2) // A e B
    expect(k.valorDevolvido).toBe(150)
    expect(k.taxaDevolucao).toBeCloseTo(150 / 250)
    expect(k.ticketMedioDevolucao).toBe(75)
  })
})

describe("devolucaoPorMes", () => {
  it("agrupa por mês com taxa sobre o faturamento do mês", () => {
    const meses = devolucaoPorMes(PEDIDOS)
    expect(meses).toEqual([
      { mes: "2026-05", valorDevolvido: 50, faturamento: 50, taxa: 1 },
      { mes: "2026-06", valorDevolvido: 100, faturamento: 200, taxa: 0.5 },
    ])
  })
})

describe("devolucaoPorCanal", () => {
  it("agrupa por canal ordenando por valor devolvido", () => {
    const canais = devolucaoPorCanal(PEDIDOS)
    expect(canais[0]).toEqual({ canal: "Mercado Livre", pedidos: 1, valorDevolvido: 100, taxa: 0.5 })
    expect(canais[1].canal).toBe("Olist ERP")
  })
})
