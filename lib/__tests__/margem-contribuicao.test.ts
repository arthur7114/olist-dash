import { describe, expect, it } from "vitest"
import { calcularKPIs, excluirMovimentacaoEstoque, normalizarBaseValor, type Pedido } from "@/lib/data"
import { agregarPorSku, skuPorMes } from "@/lib/sku-analytics"
import { rowToPedido } from "@/lib/db/orders"
import type { orders } from "@/lib/db/schema"

function pedido(over: Partial<Pedido>): Pedido {
  return {
    id: "1", numeroPedido: "1", numeroNF: "-", sku: "SKU", produto: "Produto",
    canal: "Mercado Livre", vendedor: "Loja", formaPagamento: "Pix",
    valorVenda: 100, valorFrete: 10, devolucao: 0, taxaComissao: 15, custoTotal: 40,
    quantidade: 1, statusPagamento: "Pago", data: "2026-08-01",
    ...over,
  }
}

describe("margem de contribuição com pedido cancelado", () => {
  // Venda 100, custo 40, frete 10, tarifa 15 → MC 35. O cancelado não deve mexer nisso.
  const vendido = pedido({ id: "v" })
  const cancelado = pedido({ id: "c", situacao: 2, devolucao: 100, statusPagamento: "Estornado" })

  it("cancelado não gera prejuízo: a MC é só a do pedido vendido", () => {
    const kpi = calcularKPIs([vendido, cancelado])
    expect(kpi.lucroBruto).toBeCloseTo(35)
    expect(kpi.margemMedia).toBeCloseTo(0.35)
  })

  it("cancelado continua contando como devolução e no faturamento bruto", () => {
    const kpi = calcularKPIs([vendido, cancelado])
    expect(kpi.faturamentoBruto).toBe(200)
    expect(kpi.totalDevolucoes).toBe(100)
  })
})

describe("margem por SKU com pedido cancelado", () => {
  const vendido = pedido({ id: "v" })
  const cancelado = pedido({ id: "c", situacao: 2, devolucao: 100, statusPagamento: "Estornado" })

  it("agregarPorSku: o cancelado não tira margem do SKU", () => {
    const [linha] = agregarPorSku([vendido, cancelado])
    expect(linha.margemValor).toBeCloseTo(35)
    expect(linha.margemPct).toBeCloseTo(0.35)
    expect(linha.qtdDevolvida).toBe(1)
  })

  it("skuPorMes: o cancelado não tira margem do mês", () => {
    const [mes] = skuPorMes("SKU", [vendido, cancelado])
    expect(mes.margem).toBeCloseTo(35)
    expect(mes.devolucao).toBe(100)
  })
})

describe("movimentação de estoque lançada como pedido", () => {
  // Caso real: pedido 3570, venda direta em aberto, 906 un a R$ 1,00 e R$ 24,9 mil de custo.
  const movimentacao = pedido({
    id: "3570", canal: "Olist ERP", situacao: 0, statusPagamento: "Pendente",
    valorVenda: 906, quantidade: 906, custoTotal: 24_900, valorFrete: 0, taxaComissao: 0,
  })

  it("sai da base: pedido da venda direta em aberto a até R$ 1 por unidade", () => {
    expect(excluirMovimentacaoEstoque([movimentacao])).toEqual([])
  })

  it("fica: a mesma venda direta com preço real", () => {
    const venda = { ...movimentacao, valorVenda: 90_600 }
    expect(excluirMovimentacaoEstoque([venda])).toEqual([venda])
  })

  it("fica: preço simbólico mas já faturado (não está em aberto)", () => {
    const faturado = { ...movimentacao, situacao: 6 }
    expect(excluirMovimentacaoEstoque([faturado])).toEqual([faturado])
  })

  it("fica: marketplace nunca é movimentação, mesmo barato e em aberto", () => {
    const ml = { ...movimentacao, canal: "Mercado Livre" as const }
    expect(excluirMovimentacaoEstoque([ml])).toEqual([ml])
  })
})

describe("leitura do banco", () => {
  it("o pedido lido do banco carrega a situação da Olist", () => {
    const row = {
      olistId: "9", numeroPedido: "9", numeroNf: "-", sku: "SKU", produto: "P", canal: "Mercado Livre",
      vendedor: "Loja", formaPagamento: "Pix", valorVenda: "100", valorFrete: "0", devolucao: "100",
      taxaComissao: "0", custoTotal: "40", valorNota: null, dataNota: null, quantidade: 1,
      statusPagamento: "Pendente", situacao: 2, data: "2026-08-01",
    } as unknown as typeof orders.$inferSelect
    expect(rowToPedido(row).situacao).toBe(2)
  })
})

describe("base de valor padrão", () => {
  it("sem escolha, o painel usa a nota fiscal", () => {
    expect(normalizarBaseValor(null)).toBe("nota")
    expect(normalizarBaseValor(undefined)).toBe("nota")
    expect(normalizarBaseValor("qualquer")).toBe("nota")
  })

  it("respeita quem escolheu a data da venda", () => {
    expect(normalizarBaseValor("venda")).toBe("venda")
  })
})
