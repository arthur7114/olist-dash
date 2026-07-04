import { describe, expect, it } from "vitest"
import { agregarPorSku, prepararMatrizMargem, skuPorMes, type LinhaSku } from "@/lib/sku-analytics"
import type { Pedido } from "@/lib/data"

function linhaSku(parcial: Partial<LinhaSku>): LinhaSku {
  return {
    sku: "A", produto: "Prod A", canais: ["Mercado Livre"], pedidos: 1,
    qtdVendida: 1, qtdDevolvida: 0, faturamento: 1000, devolucaoValor: 0,
    faturamentoLiquido: 1000, custoTotal: 500, taxaAlocada: 0, freteAlocado: 0,
    margemValor: 200, margemPct: 0.2, markup: 2, ticketMedio: 1000, taxaDevolucao: 0,
    semCusto: false, alertas: [], ...parcial,
  }
}

function pedido(parcial: Partial<Pedido>): Pedido {
  return {
    id: "1", numeroPedido: "P1", numeroNF: "-", sku: "A", produto: "Prod A",
    canal: "Mercado Livre", vendedor: "Sem vendedor", formaPagamento: "Pix",
    valorVenda: 100, valorFrete: 0, devolucao: 0, taxaComissao: 0, custoTotal: 0,
    quantidade: 1, statusPagamento: "Pago", data: "2026-06-10",
    ...parcial,
  }
}

describe("agregarPorSku", () => {
  it("rateia taxa e frete pelos itens proporcionalmente ao valor", () => {
    const p = pedido({
      valorVenda: 150, taxaComissao: 30, valorFrete: 15, custoTotal: 60,
      itens: [
        { sku: "A", descricao: "Prod A", quantidade: 1, valorUnitario: 100, custoUnitario: 40 },
        { sku: "B", descricao: "Prod B", quantidade: 1, valorUnitario: 50, custoUnitario: 20 },
      ],
    })
    const linhas = agregarPorSku([p])
    const a = linhas.find((l) => l.sku === "A")!
    const b = linhas.find((l) => l.sku === "B")!
    expect(a.faturamento).toBe(100)
    expect(a.taxaAlocada).toBeCloseTo(20) // 100/150 de 30
    expect(a.freteAlocado).toBeCloseTo(10)
    expect(a.margemValor).toBeCloseTo(100 - 40 - 20 - 10)
    expect(b.taxaAlocada).toBeCloseTo(10)
  })
  it("pedido devolvido zera receita líquida do SKU e conta qtdDevolvida", () => {
    const p = pedido({
      devolucao: 100,
      itens: [{ sku: "A", descricao: "Prod A", quantidade: 2, valorUnitario: 50, custoUnitario: 10 }],
    })
    const a = agregarPorSku([p])[0]
    expect(a.devolucaoValor).toBe(100)
    expect(a.faturamentoLiquido).toBe(0)
    expect(a.qtdDevolvida).toBe(2)
    expect(a.alertas).toContain("alta-devolucao")
  })
  it("sem itens usa o pedido como item único (fallback)", () => {
    const a = agregarPorSku([pedido({ custoTotal: 30, quantidade: 2 })])[0]
    expect(a.sku).toBe("A")
    expect(a.qtdVendida).toBe(2)
    expect(a.custoTotal).toBe(30)
  })
  it("marca sem-custo e margem-baixa", () => {
    const linhas = agregarPorSku([
      pedido({ sku: "SC", produto: "Sem custo", custoTotal: 0, itens: [{ sku: "SC", descricao: "Sem custo", quantidade: 1, valorUnitario: 100, custoUnitario: 0 }] }),
      pedido({ id: "2", sku: "MB", produto: "Margem baixa", taxaComissao: 90, itens: [{ sku: "MB", descricao: "Margem baixa", quantidade: 1, valorUnitario: 100, custoUnitario: 5 }] }),
    ])
    expect(linhas.find((l) => l.sku === "SC")!.alertas).toContain("sem-custo")
    expect(linhas.find((l) => l.sku === "MB")!.alertas).toContain("margem-baixa")
  })
})

describe("prepararMatrizMargem", () => {
  it("mantém o eixo legível mesmo com outlier extremo (SKU de micro-faturamento)", () => {
    const linhas = [
      linhaSku({ sku: "OK1", margemPct: 0.25 }),
      linhaSku({ sku: "OK2", margemPct: 0.1 }),
      linhaSku({ sku: "OK3", margemPct: -0.15 }),
      // R$1 de faturamento com frete rateado gera margem de -3060%
      linhaSku({ sku: "OUT", faturamento: 1, margemPct: -30.6, alertas: ["margem-baixa"] }),
    ]
    const { pontos, dominioY } = prepararMatrizMargem(linhas)
    const [lo, hi] = dominioY
    // o domínio não é arrastado até -30; fica numa faixa legível
    expect(lo).toBeGreaterThan(-1.1)
    expect(hi).toBeLessThanOrEqual(1.1)
    expect(lo).toBeLessThan(0)
    // o outlier é fixado na borda inferior para plotagem, mas preserva o valor real
    const out = pontos.find((p) => p.sku === "OUT")!
    expect(out.yReal).toBe(-30.6)
    expect(out.y).toBeGreaterThanOrEqual(lo)
    expect(out.foraDaEscala).toBe(true)
    // pontos normais mantêm o valor real dentro do domínio
    const ok1 = pontos.find((p) => p.sku === "OK1")!
    expect(ok1.y).toBeCloseTo(0.25)
    expect(ok1.foraDaEscala).toBe(false)
  })

  it("ignora SKUs sem faturamento e mantém 0% visível", () => {
    const { pontos, dominioY } = prepararMatrizMargem([
      linhaSku({ sku: "Z", faturamento: 0, margemPct: 0.5 }),
      linhaSku({ sku: "P", margemPct: 0.3 }),
    ])
    expect(pontos.map((p) => p.sku)).toEqual(["P"])
    expect(dominioY[0]).toBeLessThanOrEqual(0)
    expect(dominioY[1]).toBeGreaterThanOrEqual(0)
  })
})

describe("skuPorMes", () => {
  it("agrupa por yyyy-mm", () => {
    const meses = skuPorMes("A", [
      pedido({ data: "2026-05-10" }),
      pedido({ id: "2", data: "2026-05-20" }),
      pedido({ id: "3", data: "2026-06-01" }),
    ])
    expect(meses.map((m) => m.mes)).toEqual(["2026-05", "2026-06"])
    expect(meses[0].faturamento).toBe(200)
  })
})
